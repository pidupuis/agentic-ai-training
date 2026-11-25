# Introduction à la bioinformatique

Les connaissances métier derrière Variant Copilot : ce que les données veulent dire, pas comment le code fonctionne (ça, c'est dans les docstrings). Chaque section répond à une question qu'on se pose en lisant un résultat d'outil.

_Version anglaise : [bio-primer.md](bio-primer.md)._

## De l'ADN à la protéine

Le **génome** est la séquence complète de l'ADN d'un organisme, répartie en chromosomes (1 à 22, X, Y, et MT pour la mitochondrie). Un **gène** est une région d'un chromosome transcrite en ARN.

Un gène produit plusieurs **transcrits** : lors de l'épissage, différentes combinaisons d'exons sont conservées. Chaque transcrit codant est traduit en **protéine** : trois bases d'ADN (un **codon**) donnent un acide aminé.

Ensembl donne à chaque niveau son propre identifiant :

| Préfixe | Niveau    | Exemple                      |
| ------- | --------- | ---------------------------- |
| `ENSG…` | gène      | `ENSG00000080824` (HSP90AA1) |
| `ENST…` | transcrit | `ENST00000216281`            |
| `ENSP…` | protéine  | `ENSP00000216281`            |

Comme un gène a plusieurs transcrits, la même modification de l'ADN peut toucher l'acide aminé 724 sur un transcrit, une autre position sur un deuxième, et rien du tout sur un transcrit non codant. On décrit donc toujours les résultats sur un transcrit de référence : le **transcrit canonique**, aujourd'hui le transcrit **MANE Select**, choisi d'un commun accord par Ensembl et le NCBI.

**Les brins.** L'ADN est double brin, et un gène peut se trouver sur l'un ou l'autre. Quand il est sur le brin inverse (c'est le cas de BRAF), la base lue sur le transcrit est le complément de la base du génome : `A>T` sur le génome devient `T>A` sur le transcrit (A s'apparie avec T, C avec G).

## Génome de référence et coordonnées

Une position n'a de sens qu'accompagnée de sa **version du génome** (assemblage). La référence humaine actuelle est **GRCh38** (aussi appelée hg38) ; la précédente, **GRCh37** (hg19), reste courante dans les anciens articles et certains pipelines cliniques. BRAF V600E est en 7:140753336 sur GRCh38, mais en 7:140453136 sur GRCh37.

Toutes les coordonnées de ce projet sont en GRCh38.

Un fichier **VCF** (Variant Call Format) est la sortie standard des pipelines de séquençage. Chaque variant y est décrit par quatre champs principaux : chromosome, position, base de référence (`ref`) et base alternative (`alt`). Nos variants codés en dur reprennent ces quatre champs.

Dans les URL d'Ensembl, une localisation est une région, `chromosome:début-fin`. Un variant d'une seule base commence et finit à la même position : `14:102081741-102081741`.

## La nomenclature HGVS

HGVS (du nom de la Human Genome Variation Society) est la façon standard d'écrire un variant, pour que les articles, les bases de données et les comptes rendus cliniques le décrivent de manière identique. Le préfixe indique le niveau :

| Préfixe | Niveau                    | BRAF V600E              | Se lit                                            |
| ------- | ------------------------- | ----------------------- | ------------------------------------------------- |
| `g.`    | génome                    | `7:g.140753336A>T`      | chromosome 7, position 140753336, A devient T     |
| `c.`    | ADN codant d'un transcrit | `NM_004333.6:c.1799T>A` | base 1799 à partir du codon start, T devient A    |
| `p.`    | protéine                  | `p.Val600Glu`           | acide aminé 600, une valine, devient un glutamate |

`V600E` est la forme courte de `p.Val600Glu`, avec les codes à une lettre des acides aminés (V = Val, E = Glu). Les scientifiques l'utilisent dans les titres et à l'oral : c'est donc la forme à chercher dans PubMed. HGVS recommande les codes à trois lettres, moins ambigus.

Dans ce projet, la notation `g.` sert d'entrée à Ensembl VEP, et la notation `p.` (`hgvsp`) revient dans sa réponse.

## Les types de conséquence

La **conséquence** est l'effet prédit de la modification sur le transcrit, exprimé avec les termes de la Sequence Ontology :

| Terme                                               | Signification                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `synonymous_variant` (synonyme)                     | le codon change, mais code toujours le même acide aminé                                                       |
| `missense_variant` (faux-sens)                      | un acide aminé est remplacé par un autre (les trois variants de la démo)                                      |
| `stop_gained` (non-sens)                            | un codon devient un codon stop : la protéine est tronquée                                                     |
| `frameshift_variant` (décalage du cadre de lecture) | une insertion ou une délétion qui n'est pas un multiple de 3 décale la lecture de tous les codons qui suivent |
| `splice_*_variant`                                  | la modification touche une jonction exon/intron et peut perturber l'épissage                                  |
| `intron_variant`, `intergenic_variant`              | hors de la séquence codante : en général, pas d'effet direct sur la protéine                                  |

VEP renvoie deux niveaux : `most_severe_consequence` est l'effet le plus grave sur **tous** les transcrits de tous les gènes qui se chevauchent, alors que `consequence_terms` est l'effet sur le transcrit canonique seulement.

**Les gènes chevauchants.** Deux gènes peuvent partager une région, souvent sur des brins opposés. EGFR chevauche le gène antisens EGFR-AS1, qui a un transcrit canonique mais pas de protéine. C'est pour ça que l'outil VEP garde le transcrit canonique qui a un changement protéique (`hgvsp`).

## Lire un faux-sens

Toutes les substitutions ne se valent pas. Ce qui compte, c'est à quel point les deux acides aminés diffèrent, et où se trouve le changement.

HSP90AA1 p.Asp724Asn remplace un aspartate (D, chargé négativement) par une asparagine (N, même forme, neutre). Il se trouve 4 résidus avant le **motif MEEVD** C-terminal, les cinq derniers acides aminés de Hsp90, qui recrute les co-chaperons à domaine TPR comme Cyp40. Perdre une charge à cet endroit pourrait plausiblement gêner la liaison d'un co-chaperon, mais rien dans la littérature ne le dit : une hypothèse plausible n'est pas une preuve.

## Les prédictions in silico : SIFT et PolyPhen

Les deux prédisent si un changement d'acide aminé abîme la protéine. Ce sont des **indices, pas des preuves**.

- **SIFT** regarde la conservation au cours de l'évolution : si une position ne change jamais d'une espèce à l'autre, la modifier est suspect. Valeurs : `tolerated`, `deleterious`. Le suffixe `_low_confidence` signifie que l'alignement contenait peu de séquences à cette position, ce qui est fréquent près des extrémités des protéines.
- **PolyPhen-2** ajoute des informations structurales. Valeurs : `benign`, `possibly_damaging`, `probably_damaging`.

Leur limite principale en cancérologie : ils prédisent « délétère », mais ne savent pas distinguer une _perte_ de fonction d'un _gain_ de fonction. Une mutation oncogénique comme EGFR L858R ne casse pas la protéine, elle la rend active en permanence. Pourtant, les deux outils la signalent comme délétère.

## La fréquence dans la population : gnomAD

**gnomAD** rassemble les données de séquençage de centaines de milliers de personnes sans maladie grave connue. Il donne la **fréquence allélique** (AF) : la proportion de chromosomes qui portent le variant. `gnomade` correspond aux exomes, `gnomadg` aux génomes.

- Un variant **fréquent** (AF au-dessus d'environ 1 %) est très probablement bénin : une modification nocive ne serait pas aussi courante chez des personnes en bonne santé.
- Un variant **rare** (HSP90AA1 D724N : 2,2e-05, environ 2 sur 100 000) n'apprend rien de plus. La rareté n'est pas une preuve de nocivité.
- Un variant **absent** (EGFR L858R : `null`) est attendu pour les hotspots somatiques : ils apparaissent dans les tumeurs et ne sont pas hérités, donc les personnes en bonne santé ne les portent pas.

## Somatique ou germinal

- Les variants **germinaux** sont hérités et présents dans toutes les cellules du corps. C'est ce que mesure gnomAD.
- Les variants **somatiques** sont acquis au cours de la vie, ici par la tumeur, et ne sont présents que dans les cellules tumorales.

Le séquençage d'une tumeur trouve les deux, et les séparer fait partie du travail. Nos trois variants sont traités comme somatiques.

## Les bases de variants

| Identifiant | Base   | Ce que ça veut dire                               | Ce que ça ne veut **pas** dire                   |
| ----------- | ------ | ------------------------------------------------- | ------------------------------------------------ |
| `rs…`       | dbSNP  | le variant a été soumis à dbSNP                   | quoi que ce soit sur son effet                   |
| `COSV…`     | COSMIC | le variant a été observé dans au moins une tumeur | qu'il cause le cancer (ce peut être un passager) |
| PMID        | PubMed | l'identifiant unique d'un article                 | —                                                |

Une même modification peut avoir plusieurs identifiants COSMIC (EGFR L858R en a deux), car COSMIC garde des entrées séparées selon la façon dont elle a été rapportée, et où.

**Driver ou passager.** Les tumeurs accumulent de nombreuses mutations. Les **drivers** donnent un avantage de croissance à la cellule et font progresser le cancer ; les **passagers** ont simplement suivi. Montrer à quelle catégorie appartient un variant demande de la littérature et des études fonctionnelles, pas une entrée dans une base.

## Chercher dans PubMed

PubMed indexe la littérature biomédicale. Sans balises de champ, sa traduction automatique de la requête **ignore sans prévenir les mots qu'elle ne connaît pas** : `HSP90AA1 D724N` ne cherche que le gène et renvoie environ 1 500 articles hors sujet. Avec des balises, `"HSP90AA1"[tiab] AND "D724N"[tiab]` renvoie 0, la bonne réponse.

- `[tiab]` limite un terme au titre et au résumé.
- Le champ `querytranslation` montre ce que PubMed a vraiment cherché : vérifie-le toujours.
- Les articles écrivent les variants de façon variable : `V600E`, `Val600Glu`, `BRAF(V600E)`, `c.1799T>A`. Une recherche sérieuse essaie plusieurs formes.

## Classer un variant

L'**oncogénicité** pose la question : ce variant somatique fait-il progresser le cancer ? Le standard ClinGen/CGC/VICC (2022) utilise cinq classes :

1. oncogène (oncogenic)
2. probablement oncogène (likely oncogenic)
3. **VUS**, variant de signification incertaine
4. probablement bénin (likely benign)
5. bénin (benign)

Une **VUS** est une réponse honnête, pas un échec : les preuves ne permettent pas de trancher. Classer un variant comme oncogène sur la seule base des prédictions est l'erreur à éviter. Cet outil ajoute un sixième résultat, `insufficient_evidence`, pour le cas où l'agent n'a pas pu réunir assez d'éléments pour appliquer l'échelle.

L'**actionnabilité** est une autre question : existe-t-il un traitement ? Les tiers AMP/ASCO/CAP vont du tier I (une thérapie ciblée approuvée existe, par exemple les inhibiteurs de BRAF pour le mélanome V600E) au tier IV (bénin). Un variant peut être clairement oncogène sans qu'il existe de thérapie ciblée.

## Hsp90 et ses clients

**Hsp90** est un chaperon moléculaire : il aide d'autres protéines (ses **clients**) à se replier et à rester stables. Beaucoup de kinases oncogéniques mutantes, dont BRAF V600E et EGFR L858R, en dépendent davantage que leurs formes normales. C'est pour ça que des inhibiteurs de Hsp90 ont été développés comme médicaments anticancéreux. **HSP90AA1** est le gène qui code Hsp90α, la forme inductible.

Les trois variants de la démo suivent ce fil : deux oncogènes dépendants de Hsp90, avec une littérature abondante, et un variant de Hsp90 lui-même, sans aucun article.

## Le poids des preuves

| Signal                                                      | Poids                                           | Exemple dans ce projet                 |
| ----------------------------------------------------------- | ----------------------------------------------- | -------------------------------------- |
| Études fonctionnelles, essais cliniques dans la littérature | fort                                            | des milliers d'articles sur BRAF V600E |
| Récurrence dans les tumeurs (COSMIC)                        | modéré, selon le nombre de cas                  | identifiants `COSV…`                   |
| Fréquence dans la population                                | fort pour « bénin » si fréquent, neutre si rare | AF gnomAD                              |
| Prédictions in silico                                       | faible                                          | SIFT, PolyPhen                         |
| Plausibilité biologique (position, charge)                  | une hypothèse à tester, pas une preuve          | D724 à côté de MEEVD                   |

C'est le raisonnement que l'agent doit reproduire : des signaux faibles ne justifient jamais à eux seuls une classification « oncogène ».
