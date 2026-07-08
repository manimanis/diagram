# Diagramme ER - Générateur Dynamique

Une application web interactive permettant de concevoir et de visualiser des diagrammes Entité-Relation (ER) en temps réel. Les diagrammes peuvent être générés à partir d'une syntaxe textuelle simple ou en important directement des requêtes SQL `CREATE TABLE`.

## ✨ Fonctionnalités Principales

*   **Génération en Temps Réel** : Le diagramme se met à jour dynamiquement pendant que vous tapez grâce à l'auto-layout.
*   **Import SQL** : Convertit automatiquement vos requêtes `CREATE TABLE` en diagramme visuel.
*   **Interface Interactive Avancée** :
    *   **Glisser-déposer (Drag & Drop)** des tables pour les positionner à votre guise.
    *   **Routage Manuel des Relations** : Ajoutez des points de contrôle (waypoints) sur les relations pour modeler finement leurs courbes (double-clic pour réinitialiser).
    *   **Canvas Infini (Zoom & Pan)** : Zoom molette centré et déplacement fluide de l'espace de travail sans contrainte de bordures.
    *   **Sélection Intelligente** : Sélection multiple (Ctrl+A / Bouton), déselection globale (clic dans le vide), et mise en évidence au survol (estompe les entités non liées).
*   **Design "IDE" Premium** : Panneau latéral redimensionnable, effet Glassmorphism, et barre d'outils d'actions compacte et modernisée.
*   **Thèmes Personnalisables** : Mode Clair, Sombre, Pastel, Forêt, Rose, etc.
*   **Gestion de Sauvegarde** : Sauvegardes locales persistantes (LocalStorage) de vos schémas, de la disposition des entités, et de vos courbes personnalisées.
*   **Exportations Haute Fidélité** :
    *   Téléchargement direct au format **SVG** vectoriel.
    *   Téléchargement direct au format **PNG** haute résolution.
    *   Bouton "Copier l'image" pour copier rapidement le PNG vers le presse-papiers.
*   **Notations** : Supporte l'affichage optionnel de la notation standard Crow's Foot.

## 🛠️ Stack Technique

*   **Frontend** : HTML5, CSS3, JavaScript Vanilla, SVG pour le rendu natif.
*   **Framework UI** : Vue.js 3 (importé via CDN, aucune étape de build requise).
*   **Backend (Parser)** : PHP (`api/parse.php`) utilisé pour analyser et transformer la grammaire textuelle en JSON.
*   **Polices** : Google Fonts (Inter).

## 🚀 Installation & Utilisation

Puisque le projet intègre un composant backend en PHP pour le parsing (`parse.php`), il doit être exécuté sur un serveur web (ex: Apache/Nginx via XAMPP, WAMP, Docker, etc.).

1.  **Cloner le projet** dans le dossier public de votre serveur local (ex: `c:\xampp\htdocs\diagram`).
2.  **Lancer votre serveur local** (Apache).
3.  **Accéder au projet** via votre navigateur à l'adresse : `http://localhost/diagram`.

## 📖 Syntaxe Textuelle

L'éditeur de texte (à gauche) attend une grammaire simple pour modéliser la base :

```text
TableName(
  colonne1, 
  colonne2, 
  colonne3, 
  PK[colonne1], 
  colonne3# -> AutreTable.id
)
```
- `PK[colonne]` définit la clé primaire.
- `# -> Table.colonne` définit une clé étrangère.

*(Vous pouvez également utiliser le bouton "Importer SQL" dans l'interface).*
