const EXAMPLE_SCHEMA = `Eleve(idEleve, nomEl, PrenomEl, dnEl, PK[idEleve])
Classe(idClasse, libelleCl, PK[idClasse])
ClasseEleve(idEleve#, idClasse#, annee_scolaire, PK[idEleve#, idClasse#, annee_scolaire])`;

const { createApp, ref, computed } = Vue;

createApp({
  setup() {
    const schemaText = ref(EXAMPLE_SCHEMA);
    const entities = ref([]);
    const relations = ref([]);
    const viewBox = ref('');
    const error = ref('');
    const loading = ref(false);
    const dragState = ref(null);
    const draggingEntity = ref(null);

    const diagram = computed(() =>
      entities.value.length
        ? { entities: entities.value, viewBox: viewBox.value }
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
      } catch (err) {
        error.value = err.message || 'Une erreur est survenue.';
      } finally {
        loading.value = false;
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
      viewBox.value = computeViewBox(entities.value);
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
      loadExample,
      isLinkedColumn,
      onEntityPointerDown,
      onEntityPointerMove,
      onEntityPointerUp,
    };
  },
}).mount('#app');
