# Agent ou code : ce que fait le LLM, et pourquoi

L'essentiel de Variant Copilot est du code classique, déterministe. Le LLM n'intervient que là où une règle ne suffit pas, et il est entouré de garde-fous déterministes.

_English version: [agent-vs-code.md](agent-vs-code.md)._

## Le principe

> Du code déterministe partout où une règle existe ; le LLM seulement là où il faut juger du texte non structuré, avec des garde-fous déterministes autour.

Un LLM apporte trois capacités qu'aucun programme classique n'a : lire du texte libre, adapter son action suivante à ce qu'il vient de trouver, et rédiger une conclusion argumentée. Il apporte aussi trois coûts : il n'est pas déterministe, chaque appel coûte de l'argent et du temps, et il peut halluciner. Chaque tâche ci-dessous va du côté qui la traite le mieux.

## Qui fait quoi

| Tâche                                                                        | Faite par                        | Pourquoi                                                                                                                                   |
| ---------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Appeler VEP, choisir le transcrit canonique codant, extraire les champs      | code                             | Règles fixes et connues : un `if` le fait à l'identique à chaque fois, gratuitement.                                                       |
| Cache disque, limite de débit NCBI, gestion des erreurs réseau               | code                             | Infrastructure.                                                                                                                            |
| Valider le format de sortie                                                  | code (Pydantic)                  | Une règle stricte n'a pas besoin de jugement.                                                                                              |
| Vérifier que chaque URL citée a été renvoyée par un outil                    | code (`seen_urls`)               | Un contrôle doit être plus fiable que ce qu'il contrôle.                                                                                   |
| Refuser une conclusion avant toute recherche PubMed                          | code                             | Une règle de procédure.                                                                                                                    |
| Mettre `needs_expert_review` pour une VUS, un conflit ou une confiance basse | code (validateur d'`Annotation`) | Pure logique. D'abord seulement dans le prompt, puis déplacée dans le code pour qu'elle ne puisse pas être oubliée.                        |
| Ordre des étapes (VEP, puis PubMed)                                          | prompt                           | Pourrait être fixé dans le code ; laissé au prompt parce que le modèle le suit de façon fiable et que la boucle reste générique.           |
| **Écrire les requêtes PubMed et décider d'en lancer d'autres**               | **LLM**                          | Il faut connaître les synonymes (`V600E`, `Val600Glu`, `BRAF(V600E)`) et réagir aux résultats : zéro article, trop d'articles, hors sujet. |
| **Lire les résumés et en tirer des affirmations sourcées**                   | **LLM**                          | Du texte libre : aucune règle ne comprend que « constitutive activity of the MAPK pathway » veut dire gain de fonction.                    |
| **Peser des signaux contradictoires et conclure**                            | **LLM**                          | « SIFT dit délétère, aucun article n'existe » demande du jugement, et le résumé pour un biologiste est de la rédaction.                    |
| Décision finale                                                              | expert humain                    | L'outil propose ; une personne valide.                                                                                                     |

## L'alternative classique

Un pipeline fixe ressemblerait à ceci :

```
VEP → requête fixe "{gene}"[tiab] AND "{protein_short}"[tiab] → nombre d'articles → règle
      si nombre > 100 : oncogenic   si nombre == 0 : vus   sinon : likely_oncogenic
```

Il classerait correctement les trois variants de la démo, mais pour de mauvaises raisons :

- **Le nombre d'articles n'est pas l'oncogénicité.** Un variant bénin et fréquent peut être très cité, justement parce qu'on a montré qu'il est bénin. La règle ne lit jamais ce que disent les articles.
- **Aucune preuve citée.** Elle produit une étiquette, pas les affirmations qui la justifient, alors que la traçabilité est tout l'intérêt de l'outil.
- **Rigide.** Un article qui écrit `p.V600E`, ou qui ne parle que du codon 600, échappe à l'unique requête fixe.

## Agent ou workflow ?

Deux termes souvent confondus :

- Un **workflow** enchaîne des appels au LLM selon des étapes fixées dans le code.
- Un **agent** laisse le modèle choisir son action suivante dans une boucle, en fonction des résultats obtenus.

Variant Copilot est entre les deux. L'ordre général est quasiment imposé par le prompt, et la vraie autonomie se situe dans la recherche bibliographique : quelles requêtes, combien, et quand s'arrêter. Pour un outil clinique, c'est un choix délibéré : **une autonomie limitée, là où elle apporte quelque chose**.

## Les garde-fous, couche par couche

1. **Les résultats d'outils sont la seule source de faits.** Le prompt interdit les connaissances extérieures, et les outils renvoient des données courtes, propres et sourcées.
2. **Une sortie structurée.** La réponse doit être un appel à `submit_annotation` conforme au schéma Pydantic ; le texte libre est impossible (`tool_choice="required"`).
3. **L'auto-correction.** Une réponse invalide ne fait pas planter le programme : l'erreur devient le résultat de l'outil, et le modèle corrige au tour suivant.
4. **Le contrôle des URL.** Toute URL citée qu'aucun outil n'a renvoyée est refusée comme inventée.
5. **Les règles logiques dans le code.** `needs_expert_review` est imposé par le validateur du modèle.
6. **La validation humaine.** Rien n'est définitif tant qu'un expert n'a pas accepté, corrigé ou rejeté la proposition, et chaque décision est tracée.

## Limites connues

- `direction` (pour le caractère pathogène, pour le caractère bénin, ou neutre) reste un jugement du modèle. Le prompt demande que les faits de VEP soient neutres, mais rien ne l'impose.
- On vérifie l'URL d'une affirmation, pas son contenu : une affirmation pourrait déformer un article réel. Vérifier qu'elle correspond à son résumé demanderait un second appel au modèle, chargé de vérifier, ou un humain.
- Les exécutions ne sont pas totalement reproductibles : le modèle peut écrire des requêtes différentes d'un essai à l'autre. Enregistrer chaque annotation (étape 5) rend la démo rejouable.
