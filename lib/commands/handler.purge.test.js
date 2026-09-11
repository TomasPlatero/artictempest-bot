const test = require("node:test");
const assert = require("node:assert/strict");
const { PermissionFlagsBits } = require("discord.js");
const { createCommandHandler } = require("./handler");

function setup({ manageMessages = true } = {}) {
  const listeners = {};
  const calls = { bulkDeleted: [], editReplies: [], replies: [], deferred: 0 };
  const messages = [
    { id: "1", pinned: false, createdTimestamp: Date.now() - 1000 },
    { id: "2", pinned: false, createdTimestamp: Date.now() - 2000 },
  ];
  const channel = {
    messages: {
      fetch: async () => new Map(messages.map((m) => [m.id, m])),
    },
    bulkDelete: async (msgs, filterOld) => {
      calls.bulkDeleted.push({ ids: msgs.map((m) => m.id), filterOld });
    },
    permissionsFor: () => ({ has: () => manageMessages }),
  };
  const interaction = {
    isChatInputCommand: () => true,
    commandName: "limpiar",
    options: { getInteger: () => 2 },
    guild: { members: { me: {} } },
    channel,
    user: { id: "u1" },
    member: { roles: { cache: new Map() } },
    memberPermissions: {
      has: (permission) =>
        permission === PermissionFlagsBits.ManageMessages && manageMessages,
    },
    reply: async (payload) => calls.replies.push(payload),
    deferReply: async () => {
      calls.deferred += 1;
    },
    editReply: async (payload) => calls.editReplies.push(payload),
  };
  createCommandHandler({
    client: { on: (event, listener) => (listeners[event] = listener) },
    loadCommands: async () => [
      { name: "limpiar", config: { actions: [{ type: "purge_messages" }] } },
    ],
    logger: { error: () => {} },
  });
  return { run: listeners.interactionCreate, interaction, calls };
}

test("borra la cantidad pedida y responde con el resumen", async () => {
  const { run, interaction, calls } = setup();
  await run(interaction);
  assert.deepEqual(calls.bulkDeleted, [{ ids: ["1", "2"], filterOld: true }]);
  assert.equal(calls.deferred, 1);
  assert.match(calls.editReplies[0].content, /Se borraron 2 mensaje/);
});

test("exige el permiso Gestionar mensajes al usuario", async () => {
  const { run, interaction, calls } = setup({ manageMessages: false });
  await run(interaction);
  assert.equal(calls.deferred, 0);
  assert.deepEqual(calls.bulkDeleted, []);
  assert.match(calls.replies[0].content, /Gestionar mensajes/);
});
