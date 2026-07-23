// Contrôles permanents du détecteur de veille (node --test, sans réseau).
// Chaque cas verrouille un défaut trouvé par la revue adversariale du 2026-07-21 : ils ne
// doivent PLUS jamais réapparaître silencieusement.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractConsolidation, classify, computeDrift, UNREACHABLE_ALERT_RATIO,
} from "./check-consolidation.mjs";

const banner = (d) => `<div class="text-end"> À jour au ${d} </div>`;

test("extractConsolidation : bannière canonique (avec <sup>er</sup>)", () => {
  assert.equal(
    extractConsolidation(`<div class="text-end"> À jour au 1<sup>er</sup> avril 2026 </div>`),
    "2026-04-01",
  );
  assert.equal(extractConsolidation(banner("3 mars 2025")), "2025-03-03");
});

test("extractConsolidation : ignore les dates d'historique HORS text-end (finding fidélité #6)", () => {
  // Une date d'historique AVANT la bannière ne doit pas être choisie.
  const html =
    `<p>en vigueur de la mise à jour au 1 janvier 1984</p>` +
    banner("2 avril 2026");
  assert.equal(extractConsolidation(html), "2026-04-02");
});

test("extractConsolidation : ignore le contenu des <script> (finding fidélité #8)", () => {
  const html = `<script>var x="jour au 9 mai 2010";</script>` + banner("3 mars 2025");
  assert.equal(extractConsolidation(html), "2025-03-03");
});

test("extractConsolidation : ne colle pas le texte d'éléments distincts (finding fidélité #8)", () => {
  // Hors text-end, un collage inter-éléments ne doit produire aucune date.
  const html = `<td>dernière mise à jour au</td><td>5 janvier 2024</td>`;
  assert.equal(extractConsolidation(html), null);
});

test("extractConsolidation : poursuit sur un mois invalide, retient la date valide (finding fidélité #7)", () => {
  const html = banner("5 foobar 2020") + banner("3 mars 2025");
  assert.equal(extractConsolidation(html), "2025-03-03");
});

test("extractConsolidation : page atteinte sans bannière -> null (=> illisible, pas silencieux)", () => {
  assert.equal(extractConsolidation(`<html><body>rien ici</body></html>`), null);
});

test("classify : une page 200 illisible n'est PAS rangée en injoignable (finding cardinal #1/#2)", () => {
  const { illisible, injoignable, retard } = classify([
    { status: "illisible", stored: "2026-04-01", live: null },
    { status: "injoignable", stored: "2026-04-01", live: null },
    { status: "ok", stored: "2026-04-01", live: "2026-04-02" },
  ]);
  assert.equal(illisible.length, 1);
  assert.equal(injoignable.length, 1);
  assert.equal(retard.length, 1);
});

test("classify : retard / anomalie / à jour / sans date stockée", () => {
  const { retard, anomalie, sansStockee } = classify([
    { status: "ok", stored: "2026-04-01", live: "2026-04-02" }, // retard
    { status: "ok", stored: "2026-04-02", live: "2026-04-01" }, // anomalie (D1 en avance)
    { status: "ok", stored: "2026-04-01", live: "2026-04-01" }, // à jour -> aucune catégorie
    { status: "ok", stored: null, live: "2026-04-01" },          // sans date stockée
  ]);
  assert.equal(retard.length, 1);
  assert.equal(anomalie.length, 1);
  assert.equal(sansStockee.length, 1);
});

test("computeDrift : une page illisible suffit à déclencher la dérive (finding cardinal)", () => {
  const d = computeDrift({
    retard: [], anomalie: [], sansStockee: [], illisible: [{}], sansLangue: [], injoignable: [], total: 10,
  });
  assert.equal(d.drift, true);
});

test("computeDrift : injoignables sous le seuil, sans autre signal -> pas de dérive", () => {
  const injoignable = Array.from({ length: 2 }, () => ({})); // 2/100 = 2 %
  const d = computeDrift({
    retard: [], anomalie: [], sansStockee: [], illisible: [], sansLangue: [], injoignable, total: 100,
  });
  assert.equal(d.drift, false);
});

test("computeDrift : blocage massif injoignable -> alerte réseau, SANS dérive corpus (séparation 2026-07-23)", () => {
  // Dérive résolue + 33 % de 502 tenait l'issue ouverte sous le titre « rafraîchissement
  // dû » — un titre qui mentait. Les deux signaux sont désormais séparés : le workflow
  // retitre en « vérification incomplète » et ne clôt que si les DEUX sont éteints.
  const injoignable = Array.from({ length: 30 }, () => ({})); // 30/100 = 30 % >= seuil
  const d = computeDrift({
    retard: [], anomalie: [], sansStockee: [], illisible: [], sansLangue: [], injoignable, total: 100,
  });
  assert.equal(d.unreachableRatio >= UNREACHABLE_ALERT_RATIO, true);
  assert.equal(d.unreachableAlert, true);
  assert.equal(d.drift, false);
});

test("computeDrift : blocage massif + retard réel -> les DEUX drapeaux levés (le blocage ne masque pas la dérive)", () => {
  const injoignable = Array.from({ length: 30 }, () => ({}));
  const d = computeDrift({
    retard: [{}], anomalie: [], sansStockee: [], illisible: [], sansLangue: [], injoignable, total: 100,
  });
  assert.equal(d.drift, true);
  assert.equal(d.unreachableAlert, true);
});

test("computeDrift : une loi sans langue déclarée est actionnable (finding #4/#5)", () => {
  const d = computeDrift({
    retard: [], anomalie: [], sansStockee: [], illisible: [], sansLangue: [{ id: "x" }], injoignable: [], total: 0,
  });
  assert.equal(d.drift, true);
});
