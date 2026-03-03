/**
 * Mock PluginContext for integration and unit tests.
 *
 * Provides a fully-typed mock of the Sharkord PluginContext interface
 * without requiring @sharkord/plugin-sdk as a dependency.
 *
 * Referenced by: REQ-015
 */

// ---- Minimal type re-declarations to avoid importing @sharkord/plugin-sdk ----

export type TCommandArg = {
  name: string;
  description?: string;
  type: "string" | "number" | "boolean";
  required?: boolean;
  sensitive?: boolean;
};

export type TInvokerContext = {
  userId: number;
  currentVoiceChannelId?: number;
};

export interface CommandDefinition<TArgs = void> {
  name: string;
  description?: string;
  args?: TCommandArg[];
  executes(ctx: TInvokerContext, args: TArgs): Promise<unknown>;
}

export type TPluginSettingDefinition = {
  key: string;
  name: string;
  description?: string;
  type: "string" | "number" | "boolean" | "select";
  defaultValue: string | number | boolean;
  min?: number;
  max?: number;
  options?: Array<{ label: string; value: string }>;
};

export type TCreateStreamOptions = {
  channelId: number;
  title: string;
  key: string;
  avatarUrl?: string;
  producers: {
    audio?: unknown;
    video?: unknown;
  };
};

export type TExternalStreamHandle = {
  streamId: number;
  remove: () => void;
  update: (options: {
    title?: string;
    avatarUrl?: string;
    producers?: { audio?: unknown; video?: unknown };
  }) => void;
};

export type ServerEvent =
  | "user:joined"
  | "user:left"
  | "message:created"
  | "message:updated"
  | "message:deleted"
  | "voice:runtime_initialized"
  | "voice:runtime_closed";

// ---- Mock Router ----

export type MockProducer = {
  id: string;
  kind: "audio" | "video";
  closed: boolean;
  close: () => void;
  observer: {
    on: (event: string, handler: () => void) => void;
    off: (event: string, handler: () => void) => void;
  };
};

export type MockTransport = {
  id: string;
  closed: boolean;
  tuple: { localPort: number };
  close: () => void;
  produce: (options: unknown) => Promise<MockProducer>;
  produceCalls: unknown[];
};

export type MockRouter = {
  id: string;
  closed: boolean;
  close: () => void;
  createPlainTransport: (options: unknown) => Promise<MockTransport>;
  on: (event: string, handler: () => void) => void;
  off: (event: string, handler: () => void) => void;
  rtpCapabilities: {
    codecs: Array<{
      mimeType: string;
      preferredPayloadType: number;
      clockRate: number;
      channels?: number;
      parameters?: Record<string, unknown>;
    }>;
  };
};

// ---- Mock Implementations ----

let idCounter = 0;
const nextId = () => `mock-${++idCounter}`;

export const createMockProducer = (kind: "audio" | "video"): MockProducer => {
  const handlers = new Map<string, Set<() => void>>();
  const producer: MockProducer = {
    id: nextId(),
    kind,
    closed: false,
    close() {
      this.closed = true;
      const closeHandlers = handlers.get("close");
      if (closeHandlers) {
        for (const h of closeHandlers) h();
      }
    },
    observer: {
      on(event: string, handler: () => void) {
        if (!handlers.has(event)) handlers.set(event, new Set());
        handlers.get(event)!.add(handler);
      },
      off(event: string, handler: () => void) {
        handlers.get(event)?.delete(handler);
      },
    },
  };
  return producer;
};

export const createMockTransport = (): MockTransport => {
  const port = 40000 + Math.floor(Math.random() * 10000);
  return {
    id: nextId(),
    closed: false,
    tuple: { localPort: port },
    produceCalls: [],
    close() {
      this.closed = true;
    },
    async produce(options: unknown) {
      this.produceCalls.push(options);
      const opts = options as { kind?: "audio" | "video" };
      return createMockProducer(opts?.kind ?? "audio");
    },
  };
};

export const createMockRouter = (
  rtpCapabilities: MockRouter["rtpCapabilities"] = {
    codecs: [
      {
        mimeType: "video/VP8",
        preferredPayloadType: 96,
        clockRate: 90000,
        parameters: {},
      },
      {
        mimeType: "audio/opus",
        preferredPayloadType: 111,
        clockRate: 48000,
        channels: 2,
        parameters: { "minptime": 10, "useinbandfec": 1 },
      },
    ],
  }
): MockRouter => {
  const handlers = new Map<string, Set<() => void>>();
  return {
    id: nextId(),
    closed: false,
    rtpCapabilities,
    close() {
      this.closed = true;
      const closeHandlers = handlers.get("@close");
      if (closeHandlers) {
        for (const h of closeHandlers) h();
      }
    },
    async createPlainTransport(_options: unknown) {
      return createMockTransport();
    },
    on(event: string, handler: () => void) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    },
    off(event: string, handler: () => void) {
      handlers.get(event)?.delete(handler);
    },
  };
};

// ---- MockPluginContext ----

export type MockPluginContext = {
  path: string;
  log: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;

  /** All log entries recorded (for assertions) */
  logs: { level: "log" | "debug" | "error"; args: unknown[] }[];

  events: {
    on: (event: ServerEvent, handler: (...args: unknown[]) => void) => void;
    /** Simulate emitting an event (test helper) */
    emit: (event: ServerEvent, payload: unknown) => void;
    /** All registered handlers */
    handlers: Map<string, Set<(...args: unknown[]) => void>>;
  };

  actions: {
    voice: {
      getRouter: (channelId: number) => MockRouter;
      createStream: (options: TCreateStreamOptions) => TExternalStreamHandle;
      getListenInfo: () => { ip: string; announcedAddress: string | undefined };
      /** All routers created (for assertions) */
      routers: Map<number, MockRouter>;
      /** All streams created (for assertions) */
      streams: TCreateStreamOptions[];
    };
  };

  commands: {
    register: <TArgs = void>(command: CommandDefinition<TArgs>) => void;
    /** All registered commands (for assertions + invocation) */
    registered: Map<string, CommandDefinition<unknown>>;
    /** Helper: execute a registered command */
    execute: (name: string, invoker: TInvokerContext, args: unknown) => Promise<unknown>;
  };

  settings: {
    get: <T = string | number | boolean>(key: string) => T | undefined;
    set: (key: string, value: string | number | boolean) => void;
    register: (
      definitions: readonly TPluginSettingDefinition[]
    ) => Promise<{
      get: (key: string) => string | number | boolean;
      set: (key: string, value: string | number | boolean) => void;
    }>;
    registeredDefinitions: TPluginSettingDefinition[];
  };

  ui: {
    registerComponents: (components: unknown) => void;
    /** Registered components (for assertions) */
    registeredComponents: unknown[];
  };
};

export const createMockPluginContext = (): MockPluginContext => {
  const logs: MockPluginContext["logs"] = [];
  const eventHandlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const routers = new Map<number, MockRouter>();
  const streams: TCreateStreamOptions[] = [];
  const registeredCommands = new Map<string, CommandDefinition<unknown>>();
  const registeredComponents: unknown[] = [];
  const registeredSettingDefinitions: TPluginSettingDefinition[] = [];
  const settingsStore = new Map<string, string | number | boolean>();

  let streamIdCounter = 0;

  const ctx: MockPluginContext = {
    path: "/mock/plugin/path",

    log(...args: unknown[]) {
      logs.push({ level: "log", args });
    },
    debug(...args: unknown[]) {
      logs.push({ level: "debug", args });
    },
    error(...args: unknown[]) {
      logs.push({ level: "error", args });
    },
    logs,

    events: {
      on(event: ServerEvent, handler: (...args: unknown[]) => void) {
        if (!eventHandlers.has(event)) eventHandlers.set(event, new Set());
        eventHandlers.get(event)!.add(handler);
      },
      emit(event: ServerEvent, payload: unknown) {
        const handlers = eventHandlers.get(event);
        if (handlers) {
          for (const h of handlers) h(payload);
        }
      },
      handlers: eventHandlers,
    },

    actions: {
      voice: {
        getRouter(channelId: number) {
          if (!routers.has(channelId)) {
            routers.set(channelId, createMockRouter());
          }
          return routers.get(channelId)!;
        },
        createStream(options: TCreateStreamOptions) {
          streams.push(options);
          const id = ++streamIdCounter;
          return {
            streamId: id,
            remove() {},
            update() {},
          };
        },
        getListenInfo() {
          return { ip: "127.0.0.1", announcedAddress: undefined };
        },
        routers,
        streams,
      },
    },

    commands: {
      register<TArgs = void>(command: CommandDefinition<TArgs>) {
        registeredCommands.set(
          command.name,
          command as unknown as CommandDefinition<unknown>
        );
      },
      registered: registeredCommands,
      async execute(name: string, invoker: TInvokerContext, args: unknown) {
        const cmd = registeredCommands.get(name);
        if (!cmd) throw new Error(`Command '${name}' not registered`);
        return cmd.executes(invoker, args);
      },
    },

    settings: {
      get<T = string | number | boolean>(key: string): T | undefined {
        return settingsStore.get(key) as T | undefined;
      },
      set(key: string, value: string | number | boolean) {
        settingsStore.set(key, value);
      },
      async register(definitions: readonly TPluginSettingDefinition[]) {
        registeredSettingDefinitions.splice(0, registeredSettingDefinitions.length, ...definitions);
        for (const def of definitions) {
          settingsStore.set(def.key, def.defaultValue);
        }
        return {
          get(key: string) {
            const value = settingsStore.get(key);
            if (value === undefined) throw new Error(`Setting '${key}' not found`);
            return value;
          },
          set(key: string, value: string | number | boolean) {
            if (!settingsStore.has(key)) throw new Error(`Setting '${key}' not found`);
            settingsStore.set(key, value);
          },
        };
      },
      registeredDefinitions: registeredSettingDefinitions,
    },

    ui: {
      registerComponents(components: unknown) {
        registeredComponents.push(components);
      },
      registeredComponents,
    },
  };

  return ctx;
};
