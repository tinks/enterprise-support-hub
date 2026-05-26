import { vi } from "vitest";

// In-memory dataset that tests can mutate before render.
export const supabaseFixture: {
  tables: Record<string, any[]>;
  rpc: Record<string, any>;
  functions: Record<string, any>;
} = {
  tables: {
    conversation_mappings: [],
    gmail_conversations: [],
    manual_conversations: [],
    pending_intercom_links: [],
    settings: [{ product_areas: "SSO,SCIM,Other" }],
  },
  rpc: {
    search_conversations: [],
  },
  functions: {
    "list-slack-users": { users: [] },
    "list-slack-channels": { channels: [] },
  },
};

function resolveTable(name: string): any[] {
  return supabaseFixture.tables[name] ?? [];
}

// Chainable query builder mock. Supports: select, order, eq, in, gte, lte,
// range, limit, single, update. All non-terminal calls return `this`; terminal
// calls (`range`, `single`, awaiting the builder, `update`) resolve to
// `{ data, error: null }`.
function makeBuilder(table: string) {
  const rows = resolveTable(table);
  const result: any = { data: rows, error: null };

  const builder: any = {
    select: () => builder,
    order: () => builder,
    eq: () => builder,
    in: () => builder,
    gte: () => builder,
    lte: () => builder,
    not: () => builder,
    is: () => builder,
    or: () => builder,
    limit: () => builder,
    single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    range: () => Promise.resolve(result),
    update: () => ({
      eq: () => Promise.resolve({ data: null, error: null }),
      in: () => Promise.resolve({ data: null, error: null }),
    }),
    insert: () => Promise.resolve({ data: null, error: null }),
    delete: () => ({
      eq: () => Promise.resolve({ data: null, error: null }),
      in: () => Promise.resolve({ data: null, error: null }),
    }),
    then: (resolve: any, reject: any) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

export const supabase = {
  from: vi.fn((table: string) => makeBuilder(table)),
  rpc: vi.fn((name: string) =>
    Promise.resolve({ data: supabaseFixture.rpc[name] ?? [], error: null }),
  ),
  functions: {
    invoke: vi.fn((name: string) =>
      Promise.resolve({ data: supabaseFixture.functions[name] ?? {}, error: null }),
    ),
  },
  auth: {
    signOut: vi.fn(() => Promise.resolve({ error: null })),
    getSession: vi.fn(() =>
      Promise.resolve({ data: { session: null }, error: null }),
    ),
    onAuthStateChange: vi.fn(() => ({
      data: { subscription: { unsubscribe: () => {} } },
    })),
  },
  channel: vi.fn(() => ({
    on: () => ({ subscribe: () => ({}) }),
    subscribe: () => ({}),
    unsubscribe: () => {},
  })),
  removeChannel: vi.fn(),
};
