const EXAMPLE_SCHEMA = `Personne(matricule# -> Etudiant.matricule, user, password, PK[matricule#])
Etudiant(matricule, nom, prenom, dateNaiss, adresse, telephone, PK[matricule])
Professeur(idProf, nomProf, prenomProf, specialite, email, PK[idProf])
Cours(idCours, intitule, credits, semestre, PK[idCours])
Inscription(idEtudiant# -> Etudiant.matricule, idCours# -> Cours.idCours, dateInscription, note, PK[idEtudiant#, idCours#])
Enseignement(idProf# -> Professeur.idProf, idCours# -> Cours.idCours, anneeAcademique, salle, PK[idProf#, idCours#, anneeAcademique])
Departement(idDept, nomDept, chefDept# -> Professeur.idProf, PK[idDept])
Matiere(idMatiere, libelle, coefficient, idDept# -> Departement.idDept, PK[idMatiere])
Examen(idExamen, type, dateExamen, duree, idMatiere# -> Matiere.idMatiere, PK[idExamen])
Note(idEtudiant# -> Etudiant.matricule, idExamen# -> Examen.idExamen, valeur, appreciation, PK[idEtudiant#, idExamen#])
Salle(idSalle, code, capacite, batiment, PK[idSalle])`;

const { createApp, ref, computed, watch } = Vue;

createApp({
  setup() {
    const schemaText = ref(localStorage.getItem('schemaText') || EXAMPLE_SCHEMA);
    const entities = ref([]);
    const relations = ref([]);
    const viewBox = ref('');
    const viewBoxWidth = ref(0);
    const viewBoxHeight = ref(0);
    const error = ref('');
    const loading = ref(false);
    const theme = ref(localStorage.getItem('theme') || 'light');
    const selectedEntities = ref(new Set());
    const dragState = ref(null);
    const draggingEntity = ref(null);
    const zoomLevel = ref(1);
    const panOffset = ref({ x: 0, y: 0 });
    const undoStack = ref([]);
    const redoStack = ref([]);
    const isPanning = ref(false);
    const panStart = ref(null);
    const saves = ref(JSON.parse(localStorage.getItem('saves') || '[]'));
    const selectedSave = ref('');
    const saveName = ref('');
    const useCrowsFoot = ref(localStorage.getItem('useCrowsFoot') === 'true');
    const fontSize = ref(Number(localStorage.getItem('fontSize')) || 14);
    const snapToGrid = ref(localStorage.getItem('snapToGrid') !== 'false');
    const showThemeMenu = ref(false);
    const hoveredEntity = ref(null);
    let generateTimeout = null;
    
    const isSidebarOpen = ref(localStorage.getItem('isSidebarOpen') !== 'false');
    const sidebarWidth = ref(Number(localStorage.getItem('sidebarWidth')) || 380);
    const isResizing = ref(false);

    const themeNames = {
      light: 'Clair',
      pastel: 'Pastel',
      forest: 'Forêt',
      rose: 'Rose',
      dark: 'Sombre'
    };

    const diagramStats = computed(() => {
      if (!entities.value.length) return null;
      const rels = renderedRelations.value;
      return {
        entities: entities.value.length,
        relations: rels.length,
        attributes: entities.value.reduce((sum, e) => sum + (e.attributes ? e.attributes.length : 0), 0)
      };
    });

    const diagram = computed(() =>
      entities.value.length
        ? { 
            entities: entities.value, 
            viewBox: viewBox.value, 
            viewBoxWidth: viewBoxWidth.value, 
            viewBoxHeight: viewBoxHeight.value,
            useCrowsFoot: useCrowsFoot.value,
            fontSize: fontSize.value
          }
        : null
    );

    const renderedRelations = computed(() =>
      computeRelations(entities.value, relations.value, useCrowsFoot.value)
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

    function getEntityColor(entityName) {
      return '#fff';
    }

    function saveEntityPositions() {
      const positions = {};
      for (const e of entities.value) {
        positions[e.name] = { x: e.x, y: e.y };
      }
      localStorage.setItem('entityPositions', JSON.stringify(positions));
    }

    function restoreEntityPositions() {
      const saved = localStorage.getItem('entityPositions');
      if (!saved) return;
      try {
        const positions = JSON.parse(saved);
        window._restorePositions = positions;
      } catch (_) { }
    }

    function saveState() {
      undoStack.value.push(JSON.stringify(entities.value.map(e => ({ name: e.name, x: e.x, y: e.y }))));
      if (undoStack.value.length > 50) undoStack.value.shift();
      redoStack.value = [];
    }

    function undo() {
      if (undoStack.value.length === 0) return;
      const current = JSON.stringify(entities.value.map(e => ({ name: e.name, x: e.x, y: e.y })));
      redoStack.value.push(current);
      const previous = undoStack.value.pop();
      if (previous) {
        const positions = JSON.parse(previous);
        for (const e of entities.value) {
          const pos = positions.find(p => p.name === e.name);
          if (pos) {
            e.x = pos.x;
            e.y = pos.y;
          }
        }
        const computedRels = computeRelations(entities.value, relations.value, useCrowsFoot.value);
        const vbStr = computeViewBox(entities.value, computedRels);
        viewBox.value = vbStr;
        const [_, __, vbW, vbH] = vbStr.split(' ').map(Number);
        viewBoxWidth.value = vbW;
        viewBoxHeight.value = vbH;
        saveEntityPositions();
      }
    }

    function redo() {
      if (redoStack.value.length === 0) return;
      const current = JSON.stringify(entities.value.map(e => ({ name: e.name, x: e.x, y: e.y })));
      undoStack.value.push(current);
      const next = redoStack.value.pop();
      if (next) {
        const positions = JSON.parse(next);
        for (const e of entities.value) {
          const pos = positions.find(p => p.name === e.name);
          if (pos) {
            e.x = pos.x;
            e.y = pos.y;
          }
        }
        const computedRels = computeRelations(entities.value, relations.value, useCrowsFoot.value);
        const vbStr = computeViewBox(entities.value, computedRels);
        viewBox.value = vbStr;
        const [_, __, vbW, vbH] = vbStr.split(' ').map(Number);
        viewBoxWidth.value = vbW;
        viewBoxHeight.value = vbH;
        saveEntityPositions();
      }
    }

    function zoomIn() {
      zoomLevel.value = Math.min(zoomLevel.value * 1.2, 3);
      applyZoom();
    }

    function zoomOut() {
      zoomLevel.value = Math.max(zoomLevel.value / 1.2, 0.3);
      applyZoom();
    }

    function resetZoom() {
      zoomLevel.value = 1;
      panOffset.value = { x: 0, y: 0 };
      const computedRels = computeRelations(entities.value, relations.value, useCrowsFoot.value);
      const vbStr = computeViewBox(entities.value, computedRels);
      viewBox.value = vbStr;
      const [_, __, vbW, vbH] = vbStr.split(' ').map(Number);
      viewBoxWidth.value = vbW;
      viewBoxHeight.value = vbH;
    }

    function applyZoom() {
      const computedRels = computeRelations(entities.value, relations.value, useCrowsFoot.value);
      const vbStr = computeViewBox(entities.value, computedRels);
      const [x, y, w, h] = vbStr.split(' ').map(Number);
      const scaledW = w / zoomLevel.value;
      const scaledH = h / zoomLevel.value;
      const scaledX = x - panOffset.value.x;
      const scaledY = y - panOffset.value.y;
      viewBox.value = `${scaledX} ${scaledY} ${scaledW} ${scaledH}`;
      viewBoxWidth.value = scaledW;
      viewBoxHeight.value = scaledH;
    }

    function autoLayout() {
      if (entities.value.length === 0) return;
      saveState();
      
      // Utiliser l'algorithme de layout avancé de diagram.js
      const positioned = layoutEntities(entities.value, relations.value);
      const computedRels = computeRelations(positioned, relations.value, useCrowsFoot.value);
      const vbStr = computeViewBox(positioned, computedRels);
      
      // Mettre à jour les positions des entités
      for (let i = 0; i < entities.value.length; i++) {
        entities.value[i].x = positioned[i].x;
        entities.value[i].y = positioned[i].y;
      }
      
      viewBox.value = vbStr;
      const [_, __, vbW, vbH] = vbStr.split(' ').map(Number);
      viewBoxWidth.value = vbW;
      viewBoxHeight.value = vbH;
      zoomLevel.value = 1;
      panOffset.value = { x: 0, y: 0 };
      saveEntityPositions();
    }

    function onWheel(event) {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const delta = event.deltaY > 0 ? 0.9 : 1.1;
        zoomLevel.value = Math.max(0.3, Math.min(3, zoomLevel.value * delta));
        applyZoom();
      } else {
        panOffset.value.x += event.deltaX / zoomLevel.value;
        panOffset.value.y += event.deltaY / zoomLevel.value;
        applyZoom();
      }
    }

    function onPanStart(event) {
      if (event.target.closest('.entity-group')) return;
      isPanning.value = true;
      panStart.value = { x: event.clientX, y: event.clientY };
    }

    function onPanMove(event) {
      if (!isPanning.value || !panStart.value) return;
      const dx = (event.clientX - panStart.value.x) / zoomLevel.value;
      const dy = (event.clientY - panStart.value.y) / zoomLevel.value;
      panOffset.value.x += dx;
      panOffset.value.y += dy;
      panStart.value = { x: event.clientX, y: event.clientY };
      applyZoom();
    }

    function onPanEnd() {
      isPanning.value = false;
      panStart.value = null;
    }

    function toggleCollapse(entity) {
      entity.collapsed = !entity.collapsed;
      const computedRels = computeRelations(entities.value, relations.value, useCrowsFoot.value);
      const vbStr = computeViewBox(entities.value, computedRels);
      viewBox.value = vbStr;
      const [_, __, vbW, vbH] = vbStr.split(' ').map(Number);
      viewBoxWidth.value = vbW;
      viewBoxHeight.value = vbH;
      saveEntityPositions();
    }

    function onSvgDblClick(event) {
      const svg = event.currentTarget;
      const pt = getSvgPoint(svg, event.clientX, event.clientY);
      const entityName = prompt('Nom de la nouvelle entité :');
      if (!entityName) return;
      const newEntity = {
        name: entityName,
        attributes: [],
        x: pt.x - 90,
        y: pt.y - 40,
        width: 180,
        height: 80
      };
      entities.value.push(newEntity);
      const computedRels = computeRelations(entities.value, relations.value, useCrowsFoot.value);
      const vbStr = computeViewBox(entities.value, computedRels);
      viewBox.value = vbStr;
      const [_, __, vbW, vbH] = vbStr.split(' ').map(Number);
      viewBoxWidth.value = vbW;
      viewBoxHeight.value = vbH;
      saveEntityPositions();
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

        const built = buildDiagram(data.entities, data.relations, useCrowsFoot.value);
        entities.value = built.entities;
        relations.value = built.relations;
        viewBox.value = built.viewBox;
        viewBoxWidth.value = built.viewBoxWidth;
        viewBoxHeight.value = built.viewBoxHeight;

        if (window._restorePositions) {
          for (const e of entities.value) {
            if (window._restorePositions[e.name]) {
              e.x = window._restorePositions[e.name].x;
              e.y = window._restorePositions[e.name].y;
            }
          }
          const computedRels = computeRelations(entities.value, relations.value, useCrowsFoot.value);
          const vbStr = computeViewBox(entities.value, computedRels);
          viewBox.value = vbStr;
          const [_, __, vbW, vbH] = vbStr.split(' ').map(Number);
          viewBoxWidth.value = vbW;
          viewBoxHeight.value = vbH;
          delete window._restorePositions;
        }
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

      clone.querySelectorAll('.entity-group.dragging').forEach(g => g.classList.remove('dragging'));

      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

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
        } catch (_) { }
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

      const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      try {
        const img = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('Impossible de charger l\'image SVG.'));
          img.src = url;
        });

        const scale = 2;
        const canvas = document.createElement('canvas');
        canvas.width = imgW * scale;
        canvas.height = imgH * scale;
        const ctx = canvas.getContext('2d');
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

    function isEntitySelected(entity) {
      return selectedEntities.value.has(entity.name);
    }

    function onEntityPointerDown(entity, event) {
      event.preventDefault();
      event.stopPropagation();
      const svg = event.currentTarget.closest('svg');
      const pt = getSvgPoint(svg, event.clientX, event.clientY);

      const name = entity.name;

      if (event.ctrlKey || event.metaKey) {
        const newSet = new Set(selectedEntities.value);
        if (newSet.has(name)) {
          newSet.delete(name);
        } else {
          newSet.add(name);
        }
        selectedEntities.value = newSet;
        return;
      }

      if (!selectedEntities.value.has(name)) {
        selectedEntities.value = new Set([name]);
      }

      saveState();

      const selEntities = entities.value.filter(e => selectedEntities.value.has(e.name));
      const startPositions = {};
      for (const e of selEntities) {
        startPositions[e.name] = { x: e.x, y: e.y };
      }

      dragState.value = {
        entityName: name,
        offsetX: pt.x - entity.x,
        offsetY: pt.y - entity.y,
        startPositions,
        startX: pt.x,
        startY: pt.y,
      };
      draggingEntity.value = name;
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    function onEntityPointerMove(entity, event) {
      if (!dragState.value) return;
      if (dragState.value.entityName !== entity.name) return;

      const svg = event.currentTarget.closest('svg');
      const pt = getSvgPoint(svg, event.clientX, event.clientY);
      const dx = pt.x - dragState.value.startX;
      const dy = pt.y - dragState.value.startY;

      const gridSize = 20;
      
      for (const e of entities.value) {
        if (selectedEntities.value.has(e.name)) {
          const start = dragState.value.startPositions[e.name];
          if (start) {
            let newX = start.x + dx;
            let newY = start.y + dy;
            
            if (snapToGrid.value) {
              newX = Math.round(newX / gridSize) * gridSize;
              newY = Math.round(newY / gridSize) * gridSize;
            }
            
            e.x = newX;
            e.y = newY;
          }
        }
      }

      const computedRels = computeRelations(entities.value, relations.value, useCrowsFoot.value);
      const vbStr = computeViewBox(entities.value, computedRels);
      viewBox.value = vbStr;
      const [_, __, vbW, vbH] = vbStr.split(' ').map(Number);
      viewBoxWidth.value = vbW;
      viewBoxHeight.value = vbH;
    }

    function onEntityPointerUp(entity, event) {
      if (dragState.value?.entityName !== entity.name) return;

      dragState.value = null;
      draggingEntity.value = null;
      const computedRels = computeRelations(entities.value, relations.value, useCrowsFoot.value);
      const vbStr = computeViewBox(entities.value, computedRels);
      viewBox.value = vbStr;
      const [_, __, vbW, vbH] = vbStr.split(' ').map(Number);
      viewBoxWidth.value = vbW;
      viewBoxHeight.value = vbH;
      event.currentTarget.releasePointerCapture(event.pointerId);

      saveEntityPositions();
    }

    function onKeyDown(event) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'y') {
        event.preventDefault();
        redo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
        event.preventDefault();
        selectAllEntities();
      }
    }

    function selectAllEntities() {
      if (entities.value.length === 0) return;
      selectedEntities.value = new Set(entities.value.map(e => e.name));
    }

    restoreEntityPositions();

    function isRelated(ent1, ent2) {
      if (!ent1 || !ent2) return false;
      return relations.value.some(r => (r.from === ent1 && r.to === ent2) || (r.from === ent2 && r.to === ent1));
    }

    watch(schemaText, (val) => {
      localStorage.setItem('schemaText', val);
      clearTimeout(generateTimeout);
      generateTimeout = setTimeout(() => {
        generate();
      }, 500);
    });
    watch(theme, (val) => localStorage.setItem('theme', val));
    watch(saves, (val) => localStorage.setItem('saves', JSON.stringify(val)), { deep: true });
    watch(useCrowsFoot, (val) => localStorage.setItem('useCrowsFoot', val));
    watch(fontSize, (val) => localStorage.setItem('fontSize', val));
    watch(snapToGrid, (val) => localStorage.setItem('snapToGrid', val));

    generate();

    watch(isSidebarOpen, (val) => localStorage.setItem('isSidebarOpen', val));
    watch(sidebarWidth, (val) => localStorage.setItem('sidebarWidth', val));

    function toggleSidebar() {
      isSidebarOpen.value = !isSidebarOpen.value;
    }

    function startResize(event) {
      isResizing.value = true;
      document.addEventListener('mousemove', doResize);
      document.addEventListener('mouseup', stopResize);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    function doResize(event) {
      if (!isResizing.value) return;
      let newWidth = event.clientX - 16; // 16px padding
      if (newWidth < 250) newWidth = 250;
      if (newWidth > 800) newWidth = 800;
      sidebarWidth.value = newWidth;
    }

    function stopResize() {
      if (isResizing.value) {
        isResizing.value = false;
        document.removeEventListener('mousemove', doResize);
        document.removeEventListener('mouseup', stopResize);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    }

    setTimeout(() => {
      const svg = document.querySelector('.diagram-svg');
      const wrapper = document.querySelector('.diagram-wrapper');
      if (svg) {
        svg.addEventListener('wheel', onWheel, { passive: false });
      }
      if (wrapper) {
        wrapper.addEventListener('pointerdown', onPanStart);
        window.addEventListener('pointermove', onPanMove);
        window.addEventListener('pointerup', onPanEnd);
      }
      window.addEventListener('keydown', onKeyDown);
    }, 100);

    function importSql() {
      const sql = prompt('Collez votre requête SQL CREATE TABLE :');
      if (!sql) return;
      try {
        const tables = parseSqlToSchema(sql);
        schemaText.value = tables;
        generate();
      } catch (err) {
        error.value = 'Erreur d\'import SQL : ' + err.message;
      }
    }

    function parseSqlToSchema(sql) {
      const lines = sql.split('\n');
      const tables = [];
      const regex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?(\w+)[`"\]]?\s*\(([\s\S]+?)\)/gi;
      let match;
      while ((match = regex.exec(sql)) !== null) {
        const tableName = match[1];
        const cols = match[2].split(',').map(c => c.trim()).filter(c => c);
        const attrs = [];
        const pks = [];
        const fks = [];
        for (const col of cols) {
          const upper = col.toUpperCase();
          if (upper.startsWith('PRIMARY KEY') || upper.startsWith('CONSTRAINT')) continue;
          const nameMatch = col.match(/^[`"[]?(\w+)[`"\]]?/i);
          if (!nameMatch) continue;
          const name = nameMatch[1];
          const isPk = upper.includes('PRIMARY KEY');
          const fkMatch = col.match(/REFERENCES\s+[`"[]?(\w+)[`"\]]?\s*[\(]?[`"[]?(\w+)[`"\]]?[\)]?/i);
          if (fkMatch) {
            fks.push({ name, refTable: fkMatch[1], refCol: fkMatch[2] });
          } else {
            attrs.push({ name, isPk });
            if (isPk) pks.push(name);
          }
        }
        const pkStr = pks.map(p => p + '#').join(', ');
        const fkStr = fks.map(f => f.name + '# -> ' + f.refTable + '.' + f.refCol).join(', ');
        const allAttrs = [...attrs.map(a => a.name), ...fks.map(f => f.name)];
        const tableDef = `${tableName}(${allAttrs.join(', ')}${pkStr ? ', PK[' + pks.join(', ') + ']' : ''}${fkStr ? ', ' + fkStr : ''})`;
        tables.push(tableDef);
      }
      return tables.join('\n');
    }

    function saveDiagram() {
      const name = prompt('Nom de la sauvegarde :', saveName.value || 'Sauvegarde ' + (saves.value.length + 1));
      if (!name) return;
      saveName.value = name;
      saves.value.push({
        name,
        schemaText: schemaText.value,
        theme: theme.value,
        entityPositions: JSON.parse(localStorage.getItem('entityPositions') || '{}'),
        date: new Date().toISOString()
      });
    }

    function loadSave() {
      if (selectedSave.value === '') return;
      const s = saves.value[selectedSave.value];
      if (!s) return;
      schemaText.value = s.schemaText;
      theme.value = s.theme;
      if (s.entityPositions) {
        localStorage.setItem('entityPositions', JSON.stringify(s.entityPositions));
      }
      generate();
    }

    function deleteSave() {
      if (selectedSave.value === '') return;
      if (!confirm('Supprimer cette sauvegarde ?')) return;
      saves.value.splice(selectedSave.value, 1);
      selectedSave.value = '';
    }

    return {
      schemaText,
      diagram,
      diagramStats,
      renderedRelations,
      error,
      loading,
      theme,
      selectedEntities,
      draggingEntity,
      zoomLevel,
      saves,
      selectedSave,
      saveName,
      generate,
      exportSvg,
      copyAsImage,
      loadExample,
      isLinkedColumn,
      isEntitySelected,
      isRelated,
      onEntityPointerDown,
      onEntityPointerMove,
      onEntityPointerUp,
      zoomIn,
      zoomOut,
      resetZoom,
      autoLayout,
      undo,
      redo,
      importSql,
      saveDiagram,
      loadSave,
      deleteSave,
      useCrowsFoot,
      fontSize,
      snapToGrid,
      showThemeMenu,
      hoveredEntity,
      isSidebarOpen,
      sidebarWidth,
      themeNames,
      getEntityColor,
      toggleCollapse,
      onSvgDblClick,
      selectAllEntities,
      toggleSidebar,
      startResize,
    };
  },
}).mount('#app');