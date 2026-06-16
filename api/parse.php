<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Méthode non autorisée. Utilisez POST.']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);
$text = trim($input['schema'] ?? '');

if ($text === '') {
    http_response_code(400);
    echo json_encode(['error' => 'Schéma vide.']);
    exit;
}

try {
    $result = parseSchema($text);
    echo json_encode($result, JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    http_response_code(400);
    echo json_encode(['error' => $e->getMessage()]);
}

function parseSchema(string $text): array
{
    $lines = array_values(array_filter(array_map('trim', preg_split('/\r\n|\r|\n/', $text))));

    if (empty($lines)) {
        throw new InvalidArgumentException('Aucune entité trouvée.');
    }

    $entities = [];

    foreach ($lines as $index => $line) {
        if (!preg_match('/^(\w+)\((.+)\)$/u', $line, $matches)) {
            throw new InvalidArgumentException(
                'Ligne ' . ($index + 1) . ' invalide : "' . $line . '". Format attendu : Entite(attr1, attr2, PK[cle]).'
            );
        }

        $entityName = $matches[1];
        $content = $matches[2];

        $pkNames = [];
        if (preg_match('/PK\[([^\]]+)\]/u', $content, $pkMatch)) {
            $pkNames = array_map(
                fn(string $name) => normalizeAttributeName(trim($name)),
                explode(',', $pkMatch[1])
            );
            $content = preg_replace('/,?\s*PK\[[^\]]+\]/u', '', $content);
        }

        $rawAttributes = array_values(array_filter(array_map('trim', explode(',', $content))));

        $attributes = [];
        foreach ($rawAttributes as $rawAttr) {
            $isFk = str_ends_with($rawAttr, '#');
            $name = normalizeAttributeName($rawAttr);
            $attributes[] = [
                'name' => $name,
                'isPk' => in_array($name, $pkNames, true),
                'isFk' => $isFk,
            ];
        }

        $entities[$entityName] = [
            'name' => $entityName,
            'attributes' => $attributes,
            'primaryKey' => $pkNames,
        ];
    }

    $relations = buildRelations($entities);

    return [
        'entities' => array_values($entities),
        'relations' => $relations,
    ];
}

function normalizeAttributeName(string $name): string
{
    return rtrim(trim($name), '#');
}

function buildRelations(array $entities): array
{
    $relations = [];
    $seen = [];

    foreach ($entities as $fromEntity) {
        foreach ($fromEntity['attributes'] as $attribute) {
            if (!$attribute['isFk']) {
                continue;
            }

            $target = findReferencedEntity($entities, $attribute['name'], $fromEntity['name']);
            if ($target === null) {
                continue;
            }

            $key = min($fromEntity['name'], $target['name']) . '|' .
                   max($fromEntity['name'], $target['name']) . '|' .
                   $attribute['name'];

            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;

            $fkInPk = in_array($attribute['name'], $fromEntity['primaryKey'], true);

            // Merise : côté FK (from) = (1,1) si obligatoire, (0,1) sinon ; côté référencé (to) = (0,N)
            $relations[] = [
                'from' => $fromEntity['name'],
                'to' => $target['name'],
                'via' => $attribute['name'],
                'cardinalityFrom' => $fkInPk ? '(1,1)' : '(0,1)',
                'cardinalityTo' => '(0,∞)',
            ];
        }
    }

    return $relations;
}

function findReferencedEntity(array $entities, string $fkName, string $excludeEntity): ?array
{
    foreach ($entities as $entity) {
        if ($entity['name'] === $excludeEntity) {
            continue;
        }

        if (in_array($fkName, $entity['primaryKey'], true)) {
            return $entity;
        }

        foreach ($entity['attributes'] as $attribute) {
            if ($attribute['name'] === $fkName && $attribute['isPk']) {
                return $entity;
            }
        }
    }

    return null;
}
