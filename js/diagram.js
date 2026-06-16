const ENTITY_PADDING = 12;
const HEADER_HEIGHT = 32;
const ROW_HEIGHT = 22;
const ATTRIBUTE_FIRST_Y = 48;
const MIN_ENTITY_WIDTH = 180;
const CHAR_WIDTH = 7.2;
const MARGIN = 60;
const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 800;

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

  const adj = Object.fromEntries(positioned.map((e) => [e.name, []]));
  for (const rel of relations) {
    if (adj[rel.from] && adj[rel.to]) {
      adj[rel.from].push(rel.to);
      adj[rel.to].push(rel.from);
    }
  }

  // Trouver l'entité la plus connectée comme point de départ
  let maxConn = -1;
  let startName = positioned[0]?.name;
  for (const e of positioned) {
    if (adj[e.name].length > maxConn) {
      maxConn = adj[e.name].length;
      startName = e.name;
    }
  }

  // BFS pour assigner un niveau (layer) à chaque entité
  const layer = Object.fromEntries(positioned.map((e) => [e.name, -1]));
  const queue = [startName];
  layer[startName] = 0;

  while (queue.length > 0) {
    const cur = queue.shift();
    for (const nb of adj[cur]) {
      if (layer[nb] === -1) {
        layer[nb] = layer[cur] + 1;
        queue.push(nb);
      }
    }
  }

  // Pour les entités non atteintes (graphe déconnecté), leur assigner un niveau
  let maxLayer = Math.max(...Object.values(layer).filter((l) => l >= 0), 0);
  for (const e of positioned) {
    if (layer[e.name] === -1) {
      maxLayer++;
      layer[e.name] = maxLayer;
    }
  }

  // Grouper les entités par niveau
  const byLayer = {};
  for (const e of positioned) {
    const l = layer[e.name];
    if (!byLayer[l]) byLayer[l] = [];
    byLayer[l].push(e);
  }

  const layerKeys = Object.keys(byLayer).map(Number).sort((a, b) => a - b);
  const H_GAP = 80;
  const V_GAP = 40;
  const START_X = 100;
  const START_Y = 60;

  let currentX = START_X;
  for (const lk of layerKeys) {
    const group = byLayer[lk];
    // Trier les entités d'un même niveau par nombre de connexions (les plus connectées en haut)
    group.sort((a, b) => adj[b.name].length - adj[a.name].length);

    let currentY = START_Y;
    for (const entity of group) {
      entity.x = currentX;
      entity.y = currentY;
      currentY += entity.height + V_GAP;
    }

    // Largeur max du groupe pour espacer le prochain niveau
    const maxW = Math.max(...group.map((e) => e.width));
    currentX += maxW + H_GAP;
  }

  // Ajuster le centrage vertical si tout tient dans CANVAS_HEIGHT
  const maxBottom = Math.max(...positioned.map((e) => e.y + e.height));
  if (maxBottom < CANVAS_HEIGHT) {
    const offsetY = (CANVAS_HEIGHT - maxBottom) / 2;
    for (const e of positioned) e.y += offsetY;
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
  const otherX = otherEntity.x + otherEntity.width / 2;
  const dx = otherX - (entity.x + entity.width / 2);

  // Toujours sortir par la gauche ou la droite, à la hauteur exacte de la colonne
  const side = dx >= 0 ? 'right' : 'left';
  const point = { x: dx >= 0 ? entity.x + entity.width : entity.x, y: rowY };

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
  const DIR = {
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
    top: { x: 0, y: -1 },
    bottom: { x: 0, y: 1 },
  };

  const d1 = DIR[fromSide];
  const d2 = DIR[toSide];

  const p1 = { x: fromPoint.x + d1.x * RELATION_OFFSET, y: fromPoint.y + d1.y * RELATION_OFFSET };
  const p2 = { x: toPoint.x + d2.x * RELATION_OFFSET, y: toPoint.y + d2.y * RELATION_OFFSET };

  // Option A: horizontal-first routing (go to p2.x then to p2.y)
  const midA = { x: p2.x, y: p1.y };
  // Option B: vertical-first routing (go to p2.y then to p2.x)
  const midB = { x: p1.x, y: p2.y };

  const lenA = Math.abs(midA.x - p1.x) + Math.abs(midA.y - p1.y) + Math.abs(p2.x - midA.x) + Math.abs(p2.y - midA.y);
  const lenB = Math.abs(midB.x - p1.x) + Math.abs(midB.y - p1.y) + Math.abs(p2.x - midB.x) + Math.abs(p2.y - midB.y);

  if (lenA <= lenB) {
    return `M ${fromPoint.x},${fromPoint.y} L ${p1.x},${p1.y} L ${midA.x},${midA.y} L ${p2.x},${p2.y} L ${toPoint.x},${toPoint.y}`;
  }

  return `M ${fromPoint.x},${fromPoint.y} L ${p1.x},${p1.y} L ${midB.x},${midB.y} L ${p2.x},${p2.y} L ${toPoint.x},${toPoint.y}`;
}

function offsetLabel(point, anchor, distance) {
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const len = Math.hypot(dx, dy) || 1;
  return {
    x: point.x + (dx / len) * distance,
    y: point.y + (dy / len) * distance,
  };
}

function computeRelations(entities, relations) {
  const entityMap = Object.fromEntries(entities.map((e) => [e.name, e]));

  return relations.map((rel) => {
    const fromEntity = entityMap[rel.from];
    const toEntity = entityMap[rel.to];
    if (!fromEntity || !toEntity) return null;

    const columnName = rel.via;
    const fromAttrIndex = getAttributeIndex(fromEntity, columnName);
    const toAttrIndex = getAttributeIndex(toEntity, columnName);

    if (fromAttrIndex < 0 || toAttrIndex < 0) return null;

    const fromResult = getAttributeEdgePoint(fromEntity, fromAttrIndex, toEntity);
    const toResult = getAttributeEdgePoint(toEntity, toAttrIndex, fromEntity);

    const fromPt = fromResult.point;
    const toPt = toResult.point;
    const aligned = isAligned(fromPt, fromResult.side, toPt, toResult.side);

    let pathD;
    if (aligned) {
      pathD = `M ${fromPt.x},${fromPt.y} L ${toPt.x},${toPt.y}`;
    } else {
      pathD = generateOrthogonalPath(fromPt, fromResult.side, toPt, toResult.side);
    }

    return {
      from: rel.from,
      to: rel.to,
      via: columnName,
      x1: fromPt.x,
      y1: fromPt.y,
      x2: toPt.x,
      y2: toPt.y,
      pathD,
      aligned,
      cardinalityFrom: maxCardinality(rel.cardinalityFrom),
      cardinalityTo: maxCardinality(rel.cardinalityTo),
      labelFrom: offsetLabel(fromPt, toPt, -22),
      labelTo: offsetLabel(toPt, fromPt, -22),
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
    minX - MARGIN,
    minY - MARGIN,
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
  return {
    entities: positionedEntities,
    relations,
    viewBox: computeViewBox(positionedEntities),
  };
}
