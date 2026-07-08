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
  const relCount = {};
  for (const rel of relations) {
    if (adj[rel.from] && adj[rel.to]) {
      const key = [rel.from, rel.to].sort().join('|');
      relCount[key] = (relCount[key] || 0) + 1;
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

  // ---------- 3. Layer assignment per component (longest path layering) ----------
  const layer = Object.fromEntries(positioned.map((e) => [e.name, -1]));
  for (const comp of components) {
    // Find node with max degree as root
    let startName = comp[0];
    let maxDeg = -1;
    for (const name of comp) {
      if (adj[name].length > maxDeg) {
        maxDeg = adj[name].length;
        startName = name;
      }
    }
    
    // BFS layering
    const q = [startName];
    layer[startName] = 0;
    while (q.length) {
      const cur = q.shift();
      for (const nb of adj[cur]) {
        if (layer[nb] === -1) {
          layer[nb] = layer[cur] + 1;
          q.push(nb);
        } else if (layer[nb] > layer[cur] + 1) {
          layer[nb] = layer[cur] + 1;
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
  const entityMap = Object.fromEntries(positioned.map((e) => [e.name, e]));
  
  for (let iter = 0; iter < 20; iter++) {
    let improved = false;
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
              const nb = entityMap[nbName];
              if (nb) { sum += nb.y + nb.height / 2; count++; }
            }
          }
        }
        if (li < layerKeys.length - 1) {
          const nextLayer = layerKeys[li + 1];
          for (const nbName of adj[entity.name]) {
            if (layer[nbName] === nextLayer) {
              const nb = entityMap[nbName];
              if (nb) { sum += nb.y + nb.height / 2; count++; }
            }
          }
        }
        entity._bary = count > 0 ? sum / count : entity.y + entity.height / 2;
      });
      
      const oldOrder = group.map(e => e.name).join(',');
      group.sort((a, b) => {
        if (a._bary >= 0 && b._bary >= 0) return a._bary - b._bary;
        if (a._bary >= 0) return -1;
        if (b._bary >= 0) return 1;
        return 0;
      });
      if (group.map(e => e.name).join(',') !== oldOrder) improved = true;
    }
    if (!improved) break;
  }

  // ---------- 6. Position entities ----------
  const V_GAP = 40;
  const H_GAP = 60;
  const START_X = 20;
  const START_Y = 20;

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

  // ---------- 7. Centering passes (forward + backward) ----------
  function centerPass(forward) {
    const indices = forward 
      ? Array.from({ length: layerKeys.length }, (_, i) => i)
      : Array.from({ length: layerKeys.length }, (_, i) => layerKeys.length - 1 - i);
    
    for (const li of indices) {
      if ((forward && li === 0) || (!forward && li === layerKeys.length - 1)) continue;
      
      const lk = layerKeys[li];
      const group = byLayer[lk];
      const neighborLayer = forward ? layerKeys[li - 1] : layerKeys[li + 1];

      for (const entity of group) {
        let sumCenter = 0;
        let count = 0;
        for (const nbName of adj[entity.name]) {
          if (layer[nbName] === neighborLayer) {
            const nb = entityMap[nbName];
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
        if (Math.abs(diff) > 3) return diff;
        return 0;
      });

      let currentY = START_Y;
      for (const entity of sorted) {
        const desiredY = Math.max(currentY, entity._targetY);
        entity.y = desiredY;
        currentY = entity.y + entity.height + V_GAP;
      }
    }
  }

  centerPass(true);
  centerPass(false);
  centerPass(true);
  centerPass(false);

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

function generateBezierPath(fromPoint, fromSide, toPoint, toSide, manualOffset) {
  if (manualOffset) {
    const midX = (fromPoint.x + toPoint.x) / 2;
    const midY = (fromPoint.y + toPoint.y) / 2;
    const wpX = midX + manualOffset.dx;
    const wpY = midY + manualOffset.dy;

    const CURVE = 40;
    let cp1x = fromPoint.x + (fromSide === 'right' ? CURVE : -CURVE);
    let cp1y = fromPoint.y;
    let cp4x = toPoint.x + (toSide === 'right' ? CURVE : -CURVE);
    let cp4y = toPoint.y;

    return `M ${fromPoint.x},${fromPoint.y} C ${cp1x},${cp1y} ${wpX},${wpY} ${wpX},${wpY} S ${cp4x},${cp4y} ${toPoint.x},${toPoint.y}`;
  }

  const CURVE_OFFSET = Math.max(60, Math.abs(fromPoint.x - toPoint.x) * 0.35);
  
  let cp1x = fromPoint.x + (fromSide === 'right' ? CURVE_OFFSET : -CURVE_OFFSET);
  let cp1y = fromPoint.y;
  
  let cp2x = toPoint.x + (toSide === 'right' ? CURVE_OFFSET : -CURVE_OFFSET);
  let cp2y = toPoint.y;

  // Si même côté, accentuer la courbure
  if (fromSide === toSide) {
    let offset = fromSide === 'right' ? CURVE_OFFSET + 40 : -CURVE_OFFSET - 40;
    cp1x = Math.max(fromPoint.x, toPoint.x) + offset;
    cp2x = Math.max(fromPoint.x, toPoint.x) + offset;
    if (fromSide === 'left') {
      cp1x = Math.min(fromPoint.x, toPoint.x) + offset;
      cp2x = Math.min(fromPoint.x, toPoint.x) + offset;
    }
  }

  return `M ${fromPoint.x},${fromPoint.y} C ${cp1x},${cp1y} ${cp2x},${cp2y} ${toPoint.x},${toPoint.y}`;
}

function offsetLabel(fromResult) {
  let sgn = fromResult.side === 'right' ? 1 : -1;
  return {
    x: fromResult.point.x + sgn * RELATION_OFFSET / 4,
    y: fromResult.point.y - 5 
  }
}

function detectCardinality(fromEntity, toEntity, viaAttr) {
  const fromPk = new Set((fromEntity.attributes || []).filter(a => a.isPk).map(a => a.name));
  const isFullPkRef = viaAttr && fromPk.has(viaAttr);
  if (isFullPkRef) {
    return { from: '1', to: '1' };
  }
  return { from: '1', to: '∞' };
}

function computeRelations(entities, relations, useCrowsFoot = false, manualOffsets = {}) {
  const entityMap = Object.fromEntries(entities.map((e) => [e.name, e]));

  function convertCardinality(card) {
    if (!useCrowsFoot) return card;
    if (card === '∞') return '*';
    if (card === '1') return '1';
    return card;
  }

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

    const fromPt = fromResult.point;
    const toPt = toResult.point;
    const aligned = isAligned(fromPt, fromResult.side, toPt, toResult.side);

    const relKey = `${rel.from}-${rel.to}-${rel.via}`;
    const manualOffset = manualOffsets[relKey];

    const midX = (fromPt.x + toPt.x) / 2;
    const midY = (fromPt.y + toPt.y) / 2;
    const wpX = manualOffset ? midX + manualOffset.dx : midX;
    const wpY = manualOffset ? midY + manualOffset.dy : midY;

    let pathD = generateBezierPath(fromPt, fromResult.side, toPt, toResult.side, manualOffset);

    return {
      from: rel.from,
      to: rel.to,
      via: fromAttrName,
      relKey,
      x1: fromPt.x,
      y1: fromPt.y,
      x2: toPt.x,
      y2: toPt.y,
      wpX,
      wpY,
      pathD,
      aligned,
      cardinalityFrom: convertCardinality(maxCardinality(rel.cardinalityFrom)),
      cardinalityTo: convertCardinality(maxCardinality(rel.cardinalityTo)),
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

  const startX = Math.min(0, minX - MARGIN);
  const startY = Math.min(0, minY - MARGIN);
  const endX = maxX + MARGIN;
  const endY = maxY + MARGIN;

  return [
    startX,
    startY,
    endX - startX,
    endY - startY
  ].join(' ');
}

function getSvgPoint(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function buildDiagram(entities, relations, useCrowsFoot = false, manualOffsets = {}) {
  const positionedEntities = layoutEntities(entities, relations);
  const computedRels = computeRelations(positionedEntities, relations, useCrowsFoot, manualOffsets);
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
