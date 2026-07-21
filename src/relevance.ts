// Classement de pertinence pour qclaw_find_relevant (plan-couche-decouverte §4.4/§4.5).
//
// Entièrement DÉTERMINISTE : aucun appel de modèle. Le score d'un candidat est la somme des
// signaux S1–S4 déclenchés par les tokens de la requête normalisée.
//
// ⚠️ Les poids vivent ICI et nulle part ailleurs (§4.5) : ils se calibrent avec les évals
// (tests/evals.mjs), jamais en dur dans une requête SQL.

/** Poids des signaux (§4.4). Un seul point de vérité. */
export const WEIGHTS = {
  /** S1 — token dans le libellé / l'id / la description d'un sujet -> entités mappées. */
  S1_SUBJECT: 3,
  /** S2 — token dans l'intitulé normalisé d'une division. */
  S2_DIVISION_HEADING: 2,
  /** S3 — token dans le nom normalisé d'une loi. */
  S3_LAW_NAME: 2,
  /** S4 — voisin de graphe ('cure' ou 'reglement-de') d'une entité déjà retenue. */
  S4_GRAPH_NEIGHBOUR: 1,
} as const;

/**
 * Spécificité d'un token. Un token qui ne touche qu'une poignée d'entités est
 * DISCRIMINANT (« taq », « rdprm », « courtage ») ; un token générique dans un corpus
 * entièrement juridique (« procédure », « contrat ») en touche des dizaines et n'apprend
 * presque rien. Sans ce correctif, « procédure TAQ » noie j-3 sous les sept règlements de
 * procédure civile déclenchés par le seul mot « procédure ».
 *
 * ⚠️ La pondération est CONTINUE, pas un seuil. Une falaise (« ≤ 4 entités -> ×2, sinon
 * ×1 ») a une position qui dépend de la TAILLE DU CORPUS : en passant de 47 à 78 lois,
 * « récusation » est passé de 4 à 5 entités touchées, a perdu son facteur d'un coup, et le
 * chapitre de la récusation du C.p.c. s'est fait évincer du top 8 par des dizaines de
 * simples « juge ». Décroissance douce -> le classement ne bascule plus à l'ajout d'une loi.
 *
 *   facteur(portée) = 1 + (FACTOR - 1) × min(1, MAX_REACH / portée)
 *   portée ≤ 4 -> ×2,00   5 -> ×1,80   8 -> ×1,50   20 -> ×1,20   100 -> ×1,04
 */
export const SPECIFIC_TOKEN_MAX_REACH = 4;
export const SPECIFIC_TOKEN_FACTOR = 2;

export function specificityFactor(reach: number): number {
  if (reach <= 0) return 1;
  return 1 + (SPECIFIC_TOKEN_FACTOR - 1) * Math.min(1, SPECIFIC_TOKEN_MAX_REACH / reach);
}

/**
 * Fusion RRF de la recherche hybride (plan v2, 2.3) : score(d) = Σ 1/(k + rang_liste(d)).
 * k = 60 (valeur canonique du plan). La calibration vit ICI, avec les poids S1–S4.
 */
export const RRF_K = 60;
/** Profondeur des deux listes fusionnées (FTS et vecteurs). */
export const VECTOR_TOP_K = 20;
/** Correspondances de type 'division' : seuil de score cosine et plafond d'affichage. */
export const DIVISION_MATCH_MIN_SCORE = 0.5;
export const DIVISION_MATCH_MAX = 2;
/**
 * Plancher de score cosine des correspondances d'ARTICLES vectorielles. Vectorize rend
 * TOUJOURS ses topK, pertinents ou non : sans plancher, « zzz qqq » recevait les plus
 * proches voisins d'un embedding de charabia, présentés comme des résultats.
 */
export const SEMANTIC_MIN_SCORE = 0.40;
// Calibré par MESURE en production (2026-07-21) : requête réelle EN->FR (cas 19)
// cpc 490 @ 0,525 ; requête FR vague 0,47-0,49 ; charabia « zzz qqq » max 0,303.
// 0,40 sépare avec marge des deux côtés.

/** Longueur minimale d'un token retenu (« du », « la »… n'apportent rien). */
export const MIN_TOKEN_LENGTH = 3;
/** Plafond de tokens pris en compte (borne le nombre de requêtes et le score maximal). */
export const MAX_TOKENS = 8;

/**
 * Mots vides : grammaire française + quelques mots juridiques trop génériques pour
 * discriminer dans un corpus qui est ENTIÈREMENT du droit québécois (« loi », « code »,
 * « québec » n'y apprennent rien).
 */
const STOPWORDS = new Set([
  "les", "des", "une", "un", "le", "la", "de", "du", "au", "aux", "et", "ou", "en",
  "dans", "pour", "par", "sur", "avec", "sans", "sous", "chez", "vers", "entre",
  "que", "qui", "quoi", "dont", "mais", "donc", "car", "ne", "pas", "plus", "moins",
  "est", "sont", "etre", "ete", "avoir", "fait", "faire", "tout", "tous", "toute", "toutes",
  "cette", "ces", "ceux", "celle", "son", "sa", "ses", "leur", "leurs", "mon", "ma", "mes",
  "quel", "quelle", "quels", "quelles", "comment", "pourquoi", "quand",
  // trop génériques dans ce corpus précis
  "loi", "lois", "article", "articles", "art", "code", "quebec", "droit", "droits",
]);

/** Normalisation de référence — miroir exact de pipeline/norm.py (§2). */
export function normalize(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Tokens retenus d'une requête : normalisés, dédoublonnés, sans mots vides, plafonnés. */
export function tokenize(query: string): string[] {
  const seen = new Set<string>();
  for (const raw of normalize(query).split(/[^a-z0-9]+/)) {
    if (raw.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(raw)) seen.add(raw);
    if (seen.size >= MAX_TOKENS) break;
  }
  return [...seen];
}

/**
 * Le token apparaît-il en DÉBUT DE MOT dans le texte normalisé ?
 *
 * On veut « hypotheque » ⊂ « hypothèques » et « civil » ⊂ « civile » (suffixes tolérés),
 * mais PAS « vice » ⊂ « services » : une correspondance en plein milieu d'un mot est du
 * bruit. D'où l'ancrage sur un début de mot plutôt qu'un simple `indexOf`.
 */
export function wordMatch(haystackNorm: string, token: string): boolean {
  if (!haystackNorm || !token) return false;
  for (let i = haystackNorm.indexOf(token); i !== -1; i = haystackNorm.indexOf(token, i + 1)) {
    if (i === 0 || !/[a-z0-9]/.test(haystackNorm[i - 1])) return true;
  }
  return false;
}

// --- entrées du classement ----------------------------------------------------

export interface SubjectLite {
  id: string;
  label_fr: string;
  label_norm: string;
  description_fr: string | null;
}
export interface SubjectMapLite {
  subject_id: string;
  law_id: string;
  division_path: string;
}
export interface LawLite {
  id: string;
  name_fr: string;
  name_norm: string | null;
}
export interface DivisionLite {
  law_id: string;
  path: string;
  heading: string | null;
  heading_norm: string | null;
}
export interface RelationLite {
  from_law_id: string;
  to_law_id: string;
  rel_type: string;
  source: string;
  in_corpus: number;
  note: string | null;
}

export interface RelevanceInput {
  tokens: string[];
  subjects: SubjectLite[];
  subjectMap: SubjectMapLite[];
  laws: LawLite[];
  /** Divisions DÉJÀ préfiltrées en SQL (sous-chaîne) ; on affine ici au début de mot. */
  divisions: DivisionLite[];
  relations: RelationLite[];
  /**
   * Divisions citées par subject_map, clé `law_id|path_FR` -> cible dans la langue demandée.
   * subject_map ne stocke que des chemins FR, or les identifiants Irosoft sont propres à la
   * langue : sans cette table, une réponse EN renverrait des chemins inexploitables.
   */
  mappedHeadings: Map<string, { path: string; heading: string | null }>;
}

export interface Candidate {
  law_id: string;
  /** '' = la loi entière ; sinon path Irosoft d'une division. */
  division_path: string;
  heading: string | null;
  score: number;
  pourquoi: string[];
}

const keyOf = (lawId: string, path: string) => `${lawId}|${path}`;

/**
 * Classe les candidats. Un même candidat cumule les signaux ; un signal cumule aussi
 * par token distinct (une division dont l'intitulé contient « bail » ET « logement » est
 * plus pertinente pour « bail de logement » qu'une qui n'en contient qu'un).
 */
export function rank(input: RelevanceInput, limit: number): Candidate[] {
  const { tokens } = input;

  /** Un déclenchement de signal, avant pondération par la spécificité du token. */
  interface Hit {
    token: string;
    lawId: string;
    path: string;
    heading: string | null;
    weight: number;
    why: string;
  }
  const hits: Hit[] = [];
  const hit = (token: string, lawId: string, path: string, heading: string | null,
               weight: number, why: string) => hits.push({ token, lawId, path, heading, weight, why });

  // S1 — sujets. Surface d'appariement : libellé + id + description. La description est
  // l'endroit où le juriste dépose le vocabulaire du domaine (taxonomy.json, §3.1) : c'est
  // le levier de calibrage éditorial du routeur.
  const bySubject = new Map<string, SubjectMapLite[]>();
  for (const m of input.subjectMap) {
    const arr = bySubject.get(m.subject_id);
    if (arr) arr.push(m);
    else bySubject.set(m.subject_id, [m]);
  }
  for (const s of input.subjects) {
    const hay = `${s.label_norm} ${normalize(s.id.replace(/-/g, " "))} ${normalize(s.description_fr)}`;
    for (const t of tokens) {
      if (!wordMatch(hay, t)) continue;
      for (const m of bySubject.get(s.id) ?? []) {
        const cible = m.division_path
          ? input.mappedHeadings.get(keyOf(m.law_id, m.division_path))
          : undefined;
        hit(t, m.law_id, cible?.path ?? m.division_path, cible?.heading ?? null,
          WEIGHTS.S1_SUBJECT, `matière : ${s.label_fr}`);
      }
    }
  }

  // S2 — intitulés de divisions (préfiltrés en SQL, affinés au début de mot ici).
  for (const d of input.divisions) {
    for (const t of tokens) {
      if (!wordMatch(d.heading_norm ?? "", t)) continue;
      hit(t, d.law_id, d.path, d.heading, WEIGHTS.S2_DIVISION_HEADING,
        `intitulé : ${d.heading ?? d.path}`);
    }
  }

  // S3 — noms de lois.
  for (const l of input.laws) {
    for (const t of tokens) {
      if (!wordMatch(l.name_norm ?? "", t)) continue;
      hit(t, l.id, "", null, WEIGHTS.S3_LAW_NAME, `loi : ${l.name_fr}`);
    }
  }

  // Portée de chaque token = nombre d'entités distinctes qu'il touche. Les tokens à faible
  // portée sont discriminants et pèsent davantage (cf. SPECIFIC_TOKEN_FACTOR).
  const reach = new Map<string, Set<string>>();
  for (const h of hits) {
    const set = reach.get(h.token) ?? new Set<string>();
    set.add(keyOf(h.lawId, h.path));
    reach.set(h.token, set);
  }
  const factorOf = (t: string) => specificityFactor(reach.get(t)?.size ?? 0);

  const cands = new Map<string, Candidate>();
  const add = (lawId: string, path: string, heading: string | null, pts: number, why: string) => {
    const k = keyOf(lawId, path);
    let c = cands.get(k);
    if (!c) {
      c = { law_id: lawId, division_path: path, heading, score: 0, pourquoi: [] };
      cands.set(k, c);
    }
    if (heading && !c.heading) c.heading = heading;
    c.score += pts;
    if (!c.pourquoi.includes(why)) c.pourquoi.push(why);
  };
  for (const h of hits) {
    add(h.lawId, h.path, h.heading, h.weight * factorOf(h.token), h.why);
  }

  // S4 — voisinage de graphe, UN SEUL saut depuis les entités déjà retenues (S1–S3), et
  // AU PLUS une fois par candidat : sans ce plafond, une loi à nombreux règlements (cpc)
  // récolterait un bonus proportionnel à sa popularité plutôt qu'à sa pertinence.
  const seedLaws = new Set([...cands.values()].map((c) => c.law_id));
  const gotS4 = new Set<string>();
  for (const r of input.relations) {
    if (r.source !== "cure" && r.rel_type !== "reglement-de") continue;
    if (!r.in_corpus) continue;
    const link = (target: string, other: string) => {
      if (seedLaws.has(target) || gotS4.has(target)) return;
      gotS4.add(target);
      add(target, "", null, WEIGHTS.S4_GRAPH_NEIGHBOUR, `connexe à ${other} (${r.rel_type})`);
    };
    if (seedLaws.has(r.from_law_id)) link(r.to_law_id, r.from_law_id);
    if (seedLaws.has(r.to_law_id)) link(r.from_law_id, r.to_law_id);
  }

  return [...cands.values()]
    .sort((a, b) =>
      b.score - a.score ||
      // départage stable : une cible précise (division) avant la loi entière, puis l'id
      (a.division_path ? 0 : 1) - (b.division_path ? 0 : 1) ||
      a.law_id.localeCompare(b.law_id) ||
      a.division_path.localeCompare(b.division_path))
    .slice(0, limit);
}
