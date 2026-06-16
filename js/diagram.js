const ENTITY_PADDING = 12;
const HEADER_HEIGHT = 32;
const ROW_HEIGHT = 22;
const ATTRIBUTE_FIRST_Y = 48;
const MIN_ENTITY_WIDTH = 180;
const CHAR_WIDTH = 7.2;
const MARGIN = 60;
const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 800;
const ORTHOGONAL_OFFSET = 36;

function measureEntity(entity) {
  const titleWidth = entity.name.length * CHAR_WIDTH + ENTITY_PADDING * 2;
  let maxAttrWidth = 0;

  for (const attr of entity.attributes) {
    let label = attr.name;
    if (attr.isPk) label += ' PK';
    if (attr.isFk) label += ' FK';
    maxAttrWidth = Math.max(maxAttrWidth, label.length * CHAR_WIDTH + ENTITY_PADDING * 2);
  }

  const width = Math.max(MIN_ENTITY_WIDTH, titleWidth, maxAttrWidth);
  const height = HEADER_HEIGHT + entity.attributes.length * ROW_HEIGHT + ENTITY_PADDING;

  return { width, height };
}

function maxCardinality(merise) {
  const match = merise.match(/\([^,]+,\s*([^)]+)\)/);
  return match ? match[1] : merise;
}

function layoutEntities(entities, relations) {
  const positioned = entities.map((entity) => ({
    ...entity,
    ...measureEntity(entity),
    x: 0,
    y: 0,
  }));

  if (positioned.length === 0) return positioned;

  // ---------- 1. Adjacency graph ----------
  const adj = Object.fromEntries(positioned.map((e) => [e.name, []]));
  for (const rel of relations) {
    if (adj[rel.from] && adj[rel.to]) {
      adj[rel.from].push(rel.to);
      adj[rel.to].push(rel.from);
    }
  }

  // ---------- 2. Connected components ----------
  const visited = new Set();
  const components = [];
  for (const e of positioned) {
    if (visited.has(e.name)) continue;
    const comp = [];
    const queue = [e.name];
    visited.add(e.name);
    while (queue.length) {
      const cur = queue.shift();
      comp.push(cur);
      for (const nb of adj[cur]) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    components.push(comp);
  }

  // ---------- 3. Layer assignment per component ----------
  const layer = Object.fromEntries(positioned.map((e) => [e.name, -1]));
  for (const comp of components) {
    let maxConn = -1;
    let startName = comp[0];
    for (const name of comp) {
      if (adj[name].length > maxConn) {
        maxConn = adj[name].length;
        startName = name;
      }
    }
    const q = [startName];
    layer[startName] = 0;
    while (q.length) {
      const cur = q.shift();
      for (const nb of adj[cur]) {
        if (layer[nb] === -1) {
          layer[nb] = layer[cur] + 1;
          q.push(nb);
        }
      }
    }
  }

  // ---------- 4. Group by layer ----------
  const byLayer = {};
  for (const e of positioned) {
    const l = Math.max(0, layer[e.name]);
    if (!byLayer[l]) byLayer[l] = [];
    byLayer[l].push(e);
  }
  const layerKeys = Object.keys(byLayer).map(Number).sort((a, b) => a - b);

  // ---------- 5. Determine order within each layer (barycenter for fewer crossings) ----------
  for (let iter = 0; iter < 10; iter++) {
    for (let li = 0; li < layerKeys.length; li++) {
      const lk = layerKeys[li];
      const group = byLayer[lk];
      group.forEach((entity) => {
        let sum = 0;
        let count = 0;
        if (li > 0) {
          const prevLayer = layerKeys[li - 1];
          for (const nbName of adj[entity.name]) {
            if (layer[nbName] === prevLayer) {
              const nb = positioned.find((e) => e.name === nbName);
              if (nb) { sum += nb.y; count++; }
            }
          }
        }
        if (li < layerKeys.length - 1) {
          const nextLayer = layerKeys[li + 1];
          for (const nbName of adj[entity.name]) {
            if (layer[nbName] === nextLayer) {
              const nb = positioned.find((e) => e.name === nbName);
              if (nb) { sum += nb.y; count++; }
            }
          }
        }
        entity._bary = count > 0 ? sum / count : -1;
      });
      group.sort((a, b) => {
        if (a._bary >= 0 && b._bary >= 0) return a._bary - b._bary;
        if (a._bary >= 0) return -1;
        if (b._bary >= 0) return 1;
        return 0;
      });
    }
  }

  // ---------- 6. Position entities (guarantees all entities visible, no negative coords) ----------
  const V_GAP = 48;
  const H_GAP = 130;
  const START_X = 80;
  const START_Y = 60;

  // First pass: vertical stacking per layer
  let currentX = START_X;
  for (let li = 0; li < layerKeys.length; li++) {
    const lk = layerKeys[li];
    const group = byLayer[lk];
    const maxW = Math.max(...group.map((e) => e.width));

    let currentY = START_Y;
    for (const entity of group) {
      entity.x = currentX;
      entity.y = currentY;
      currentY += entity.height + V_GAP;
    }

    currentX += maxW + H_GAP;
  }

  // ---------- 7. Gentle centering: align each entity with the center of its neighbors ----------
  // Forward pass (layer 1 → N)
  for (let li = 1; li < layerKeys.length; li++) {
    const lk = layerKeys[li];
    const group = byLayer[lk];
    const prevLayer = layerKeys[li - 1];

    // Compute target Y for each entity based on neighbors in previous layer
    for (const entity of group) {
      let sumCenter = 0;
      let count = 0;
      for (const nbName of adj[entity.name]) {
        if (layer[nbName] === prevLayer) {
          const nb = positioned.find((e) => e.name === nbName);
          if (nb) {
            sumCenter += nb.y + nb.height / 2;
            count++;
          }
        }
      }
      if (count > 0) {
        entity._targetY = sumCenter / count - entity.height / 2;
      } else {
        entity._targetY = entity.y;
      }
    }

    // Sort by target Y (blend: 50% target, 50% original order to prevent collapse)
    const sorted = [...group].sort((a, b) => {
      const diff = a._targetY - b._targetY;
      if (Math.abs(diff) > 5) return diff;
      return 0; // preserve original order
    });

    // Re-assign Y with guaranteed non-overlapping positions
    let currentY = START_Y;
    for (const entity of sorted) {
      const desiredY = Math.max(currentY, entity._targetY);
      entity.y = desiredY;
      currentY = entity.y + entity.height + V_GAP;
    }
  }

  // Backward pass (layer N → 1)
  for (let li = layerKeys.length - 2; li >= 0; li--) {
    const lk = layerKeys[li];
    const group = byLayer[lk];
    const nextLayer = layerKeys[li + 1];

    for (const entity of group) {
      let sumCenter = 0;
      let count = 0;
      for (const nbName of adj[entity.name]) {
        if (layer[nbName] === nextLayer) {
          const nb = positioned.find((e) => e.name === nbName);
          if (nb) {
            sumCenter += nb.y + nb.height / 2;
            count++;
          }
        }
      }
      if (count > 0) {
        entity._targetY = sumCenter / count - entity.height / 2;
      } else {
        entity._targetY = entity.y;
      }
    }

    const sorted = [...group].sort((a, b) => {
      const diff = a._targetY - b._targetY;
      if (Math.abs(diff) > 5) return diff;
      return 0;
    });

    let currentY = START_Y;
    for (const entity of sorted) {
      const desiredY = Math.max(currentY, entity._targetY);
      entity.y = desiredY;
      currentY = entity.y + entity.height + V_GAP;
    }
  }

  // ---------- 8. Cleanup temporary properties ----------
  for (const e of positioned) {
    delete e._bary;
    delete e._targetY;
  }

  return positioned;
}

function getAttributeIndex(entity, attrName) {
  return entity.attributes.findIndex((a) => a.name === attrName);
}

function getAttributeRowY(entity, attrIndex) {
  return entity.y + ATTRIBUTE_FIRST_Y + attrIndex * ROW_HEIGHT - 4;
}

function getAttributeEdgePoint(entity, attrIndex, otherEntity) {
  const rowY = getAttributeRowY(entity, attrIndex);
  let side;

  if (otherEntity.x > entity.x + entity.width + ORTHOGONAL_OFFSET) {
    side = 'right';
  } else {
    side = 'left';
  }

  const point = { x: side === 'right' ? entity.x + entity.width : entity.x, y: rowY };

  return { point, side };
}

const RELATION_OFFSET = 40;

function isAligned(fromPoint, fromSide, toPoint, toSide) {
  const isHoriz = (s) => s === 'left' || s === 'right';
  if (isHoriz(fromSide) && isHoriz(toSide) && Math.abs(fromPoint.y - toPoint.y) < 5) {
    return true;
  }
  const isVert = (s) => s === 'top' || s === 'bottom';
  if (isVert(fromSide) && isVert(toSide) && Math.abs(fromPoint.x - toPoint.x) < 5) {
    return true;
  }
  return false;
}

function generateOrthogonalPath(fromPoint, fromSide, toPoint, toSide) {
  if (fromSide === toSide) {
    // Same side, use offset
    let offset = fromSide === 'right' ? ORTHOGONAL_OFFSET / 2 : -ORTHOGONAL_OFFSET / 2;
    let x;
    if (fromSide === 'left') {
      x = Math.min(fromPoint.x, toPoint.x);
    } else {
      x = Math.max(fromPoint.x, toPoint.x);
    }
    let mid = { x: x + offset, y: fromPoint.y };
    return `M ${fromPoint.x},${fromPoint.y} L ${mid.x},${fromPoint.y} L ${mid.x},${toPoint.y} L ${toPoint.x},${toPoint.y}`;
  } else {
    let mid = { x: (fromPoint.x  + toPoint.x) / 2, y: (fromPoint.y + toPoint.y)  / 2 }
    return `M ${fromPoint.x},${fromPoint.y} L ${mid.x},${fromPoint.y} L ${mid.x},${toPoint.y} L ${toPoint.x},${toPoint.y}`;
  }
}

function offsetLabel(fromResult) {
  let sgn = fromResult.side === 'right' ? 1 : -1;
  return {
    x: fromResult.point.x + sgn * RELATION_OFFSET / 4,
    y: fromResult.point.y - 5 
  }
}

function computeRelations(entities, relations) {
  const entityMap = Object.fromEntries(entities.map((e) => [e.name, e]));

  return relations.map((rel) => {
    const fromEntity = entityMap[rel.from];
    const toEntity = entityMap[rel.to];
    if (!fromEntity || !toEntity) return null;

    const fromAttrName = rel.via;
    const toAttrName = rel.viaTarget || rel.via;
    const fromAttrIndex = getAttributeIndex(fromEntity, fromAttrName);
    const toAttrIndex = getAttributeIndex(toEntity, toAttrName);

    if (fromAttrIndex < 0 || toAttrIndex < 0) return null;

    const fromResult = getAttributeEdgePoint(fromEntity, fromAttrIndex, toEntity);
    const toResult = getAttributeEdgePoint(toEntity, toAttrIndex, fromEntity);

    // console.log(fromEntity, toEntity);

    const fromPt = fromResult.point;
    const toPt = toResult.point;
    const aligned = isAligned(fromPt, fromResult.side, toPt, toResult.side);

    let pathD = generateOrthogonalPath(fromPt, fromResult.side, toPt, toResult.side);

    return {
      from: rel.from,
      to: rel.to,
      via: fromAttrName,
      x1: fromPt.x,
      y1: fromPt.y,
      x2: toPt.x,
      y2: toPt.y,
      pathD,
      aligned,
      cardinalityFrom: maxCardinality(rel.cardinalityFrom),
      cardinalityTo: maxCardinality(rel.cardinalityTo),
      labelFrom: offsetLabel(fromResult),
      labelTo: offsetLabel(toResult),
    };
  }).filter(Boolean);
}

function computeViewBox(entities, relations) {
  if (!entities.length) {
    return `0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const entity of entities) {
    minX = Math.min(minX, entity.x);
    minY = Math.min(minY, entity.y);
    maxX = Math.max(maxX, entity.x + entity.width);
    maxY = Math.max(maxY, entity.y + entity.height);
  }

  // Account for orthogonal relation paths that extend beyond entities
  if (relations) {
    for (const rel of relations) {
      if (rel.x1 != null) {
        minX = Math.min(minX, rel.x1);
        minY = Math.min(minY, rel.y1);
        maxX = Math.max(maxX, rel.x1);
        maxY = Math.max(maxY, rel.y1);
      }
      if (rel.x2 != null) {
        minX = Math.min(minX, rel.x2);
        minY = Math.min(minY, rel.y2);
        maxX = Math.max(maxX, rel.x2);
        maxY = Math.max(maxY, rel.y2);
      }
    }
  }

  return [
    Math.max(0, minX - MARGIN),
    Math.max(0, minY - MARGIN),
    maxX - minX + MARGIN * 2,
    maxY - minY + MARGIN * 2,
  ].join(' ');
}

function getSvgPoint(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function buildDiagram(entities, relations) {
  const positionedEntities = layoutEntities(entities, relations);
  const computedRels = computeRelations(positionedEntities, relations);
  const viewBoxStr = computeViewBox(positionedEntities, computedRels);
  console.log(viewBoxStr);
  const [vbX, vbY, vbW, vbH] = viewBoxStr.split(' ').map(Number);
  return {
    entities: positionedEntities,
    relations,
    viewBox: viewBoxStr,
    viewBoxWidth: vbW,
    viewBoxHeight: vbH,
  };
}
