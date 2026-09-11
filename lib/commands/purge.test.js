const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PURGE_MAX_AMOUNT,
  MAX_BULK_AGE_MS,
  clampAmount,
  createPurgePlan,
} = require("./purge");

test("clampAmount acepta enteros dentro de rango", () => {
  assert.equal(clampAmount("50"), 50);
  assert.equal(clampAmount(1), 1);
  assert.equal(clampAmount(PURGE_MAX_AMOUNT), PURGE_MAX_AMOUNT);
});

test("clampAmount limita por encima del máximo de Discord", () => {
  assert.equal(clampAmount(150), PURGE_MAX_AMOUNT);
  assert.equal(clampAmount("999999"), PURGE_MAX_AMOUNT);
});

test("clampAmount rechaza valores inválidos", () => {
  assert.equal(clampAmount(0), null);
  assert.equal(clampAmount(-5), null);
  assert.equal(clampAmount(""), null);
  assert.equal(clampAmount("abc"), null);
  assert.equal(clampAmount(null), null);
  assert.equal(clampAmount(undefined), null);
});

test("createPurgePlan separa recientes, antiguos y fijados sin reordenar", () => {
  const now = 1_700_000_000_000;
  const recent = (id) => ({ id, pinned: false, createdTimestamp: now - 1000 });
  const old = (id) => ({
    id,
    pinned: false,
    createdTimestamp: now - MAX_BULK_AGE_MS - 1000,
  });
  const pinned = (id) => ({ id, pinned: true, createdTimestamp: now - 1000 });

  const plan = createPurgePlan(
    [recent("a"), old("b"), pinned("c"), recent("d"), old("e")],
    now,
  );

  assert.deepEqual(
    plan.deletable.map((m) => m.id),
    ["a", "d"],
  );
  assert.deepEqual(
    plan.tooOld.map((m) => m.id),
    ["b", "e"],
  );
  assert.deepEqual(
    plan.pinned.map((m) => m.id),
    ["c"],
  );
});
