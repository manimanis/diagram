const EXAMPLE_SCHEMA = `Etudiant(matricule, nom, prenom, dateNaiss, adresse, telephone, PK[matricule])
Professeur(idProf, nomProf, prenomProf, specialite, email, PK[idProf])
Cours(idCours, intitule, credits, semestre, PK[idCours])
Inscription(idEtudiant# -> Etudiant.matricule, idCours# -> Cours.idCours, dateInscription, note, PK[idEtudiant#, idCours#])
Enseignement(idProf# -> Professeur.idProf, idCours# -> Cours.idCours, anneeAcademique, salle, PK[idProf#, idCours#, anneeAcademique])
Departement(idDept, nomDept, chefDept# -> Professeur.idProf, PK[idDept])
Matiere(idMatiere, libelle, coefficient, idDept# -> Departement.idDept, PK[idMatiere])
Examen(idExamen, type, dateExamen, duree, idMatiere# -> Matiere.idMatiere, PK[idExamen])
Note(idEtudiant# -> Etudiant.matricule, idExamen# -> Examen.idExamen, valeur, appreciation, PK[idEtudiant#, idExamen#])
Salle(idSalle, code, capacite, batiment, PK[idSalle])`;

const { createApp, ref, computed } = Vue;

createApp({
  setup() {
    const schemaText = ref(EXAMPLE_SCHEMA);
    const entities = ref([]);
    const relations = ref([]);
    const viewBox = ref('');
    const viewBoxWidth = ref(0);
    const viewBoxHeight = ref(0);
    const error = ref('');
    const loading = ref(false);
    const dragState = ref(null);
    const draggingEntity = ref(null);

    const diagram = computed(() =>
      entities.value.length
        ? { entities: entities.value, viewBox: viewBox.value, viewBoxWidth: viewBoxWidth.value, viewBoxHeight: viewBoxHeight.value }
        : null
    );

    const renderedRelations = computed(() =>
      computeRelations(entities.value, relations.value)
    );

    const linkedColumns = computed(() => {
      const set = new Set();
      for (const rel of relations.value) {
        set.add(`${rel.from}|${rel.via}`);
        set.add(`${rel.to}|${rel.via}`);
      }
      return set;
    });

    function isLinkedColumn(entityName, attrName) {
      return linkedColumns.value.has(`${entityName}|${attrName}`);
    }

    async function generate() {
      error.value = '';
      loading.value = true;
      entities.value = [];
      relations.value = [];
      viewBox.value = '';

      try {
        const response = await fetch('api/parse.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ schema: schemaText.value }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Erreur lors de l\'analyse du schéma.');
        }

        const built = buildDiagram(data.entities, data.relations);
        entities.value = built.entities;
        relations.value = built.relations;
        viewBox.value = built.viewBox;
        viewBoxWidth.value = built.viewBoxWidth;
        viewBoxHeight.value = built.viewBoxHeight;
      } catch (err) {
        error.value = err.message || 'Une erreur est survenue.';
      } finally {
        loading.value = false;
      }
    }

    function prepareSvgClone() {
      const svgEl = document.querySelector('.diagram-svg');
      if (!svgEl) return null;

      const clone = svgEl.cloneNode(true);

      // Supprimer les classes/interactions liées au drag
      clone.querySelectorAll('.entity-group.dragging').forEach(g => g.classList.remove('dragging'));

      // S'assurer que xmlns est présent
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

      // Ajouter les styles depuis les classes CSS en les inlineant dans un <style>
      const styleRules = [];
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules || sheet.rules) {
            if (rule.selectorText && rule.selectorText.includes('diagram-svg') ||
                rule.selectorText && rule.selectorText.includes('relation') ||
                rule.selectorText && rule.selectorText.includes('entity') ||
                rule.selectorText && rule.selectorText.includes('cardinality') ||
                rule.selectorText && rule.selectorText.includes('attribute') ||
                rule.selectorText && rule.selectorText.includes('badge') ||
                rule.selectorText && rule.selectorText.includes('pk') ||
                rule.selectorText && rule.selectorText.includes('fk')) {
              styleRules.push(rule.cssText);
            }
          }
        } catch (_) { /* CORS restrictions sur les feuilles externes */ }
      }
      if (styleRules.length) {
        const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
        styleEl.textContent = styleRules.join('\n');
        clone.insertBefore(styleEl, clone.firstChild);
      }

      return clone;
    }

    function exportSvg() {
      const clone = prepareSvgClone();
      if (!clone) return;

      const serializer = new XMLSerializer();
      let svgStr = serializer.serializeToString(clone);

      // Ajouter la déclaration XML
      svgStr = '<?xml version="1.0" encoding="UTF-8"?>\n' + svgStr;

      const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '_');
      a.download = `diagram_${timestamp}.svg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    async function copyAsImage() {
      const clone = prepareSvgClone();
      if (!clone) return;

      const serializer = new XMLSerializer();
      let svgStr = serializer.serializeToString(clone);

      // Obtenir les dimensions réelles du SVG
      const svgEl = document.querySelector('.diagram-svg');
      const vb = svgEl.getAttribute('viewBox');
      let imgW, imgH;
      if (vb) {
        const parts = vb.split(' ').map(Number);
        imgW = parts[2];
        imgH = parts[3];
      } else {
        imgW = svgEl.clientWidth || 800;
        imgH = svgEl.clientHeight || 600;
      }

      // Créer un Blob SVG
      const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      try {
        const img = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('Impossible de charger l\'image SVG.'));
          img.src = url;
        });

        // Facteur d'échelle pour une bonne qualité (2x)
        const scale = 2;
        const canvas = document.createElement('canvas');
        canvas.width = imgW * scale;
        canvas.height = imgH * scale;
        const ctx = canvas.getContext('2d');
        
        // Fond blanc
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);

        const blob = await new Promise((resolve, reject) => {
          canvas.toBlob((b) => {
            if (b) resolve(b);
            else reject(new Error('Impossible de générer le PNG.'));
          }, 'image/png');
        });

        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ]);

        // Feedback visuel temporaire
        const btn = document.querySelector('.diagram-toolbar .btn-sm:last-child');
        if (btn) {
          const originalText = btn.textContent;
          btn.textContent = '✓ Copié !';
          btn.classList.add('btn-success');
          setTimeout(() => {
            btn.textContent = originalText;
            btn.classList.remove('btn-success');
          }, 2000);
        }
      } catch (err) {
        console.error('Erreur de copie:', err);
        // Fallback si l'API Clipboard n'est pas supportée
        const canvas = document.createElement('canvas');
        canvas.width = imgW;
        canvas.height = imgH;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0);
          const link = document.createElement('a');
          link.download = 'diagram.png';
          link.href = canvas.toDataURL('image/png');
          link.click();
        };
        img.src = url;
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    function loadExample() {
      schemaText.value = EXAMPLE_SCHEMA;
      generate();
    }

    function onEntityPointerDown(entity, event) {
      event.preventDefault();
      const svg = event.currentTarget.closest('svg');
      const pt = getSvgPoint(svg, event.clientX, event.clientY);

      dragState.value = {
        entityName: entity.name,
        offsetX: pt.x - entity.x,
        offsetY: pt.y - entity.y,
      };
      draggingEntity.value = entity.name;
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    function onEntityPointerMove(entity, event) {
      if (!dragState.value || dragState.value.entityName !== entity.name) return;

      const svg = event.currentTarget.closest('svg');
      const pt = getSvgPoint(svg, event.clientX, event.clientY);
      entity.x = pt.x - dragState.value.offsetX;
      entity.y = pt.y - dragState.value.offsetY;
    }

    function onEntityPointerUp(entity, event) {
      if (dragState.value?.entityName !== entity.name) return;

      dragState.value = null;
      draggingEntity.value = null;
      const computedRels = computeRelations(entities.value, relations.value);
      const vbStr = computeViewBox(entities.value, computedRels);
      viewBox.value = vbStr;
      const [_, __, vbW, vbH] = vbStr.split(' ').map(Number);
      viewBoxWidth.value = vbW;
      viewBoxHeight.value = vbH;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    generate();

    return {
      schemaText,
      diagram,
      renderedRelations,
      error,
      loading,
      draggingEntity,
      generate,
      exportSvg,
      copyAsImage,
      loadExample,
      isLinkedColumn,
      onEntityPointerDown,
      onEntityPointerMove,
      onEntityPointerUp,
    };
  },
}).mount('#app');
