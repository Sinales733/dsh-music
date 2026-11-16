// The browser half of the "dshMusic" Remote: a hand-written equivalent of what dsh-typert-generator emits
// (createTypertRemoteInfo from @deepseek-ai/dsh-typert-protocol/remote-info, condensed), mounted with
// ctx.remote.$mount(). Stream items and results are plain JSON, so the result codecs only accept anything.
const zod = require('zod');

const PKG = 'dsh-music';
const anyResult = (endpoint, description) => ({ mode: 'strict', typeSymbol: `${PKG}#${endpoint}:result`, create: () => zod.z.unknown(), description, jsonSchema: {} });
const stringParam = (endpoint, name, description) => {
  const codec = { mode: 'strict', typeSymbol: `${PKG}#${endpoint}:${name}`, create: () => zod.z.string(), jsonSchema: { type: 'string' } };
  return { name, description, source: 'json', codec, strictCodec: codec };
};

const SPEC = {
  package: PKG,
  methods: {
    'dshMusic/watch': {
      service: 'dshMusic', description: 'Now playing, lyrics and volume state, replayed on open and then live.',
      mode: 'stream', invocation: { kind: 'direct' }, parameters: [], cancellation: { parameter: 'signal' },
      result: anyResult('dshMusic/watch', 'state and lyrics events'),
    },
    'dshMusic/command': {
      service: 'dshMusic', description: 'AI state changes and player controls.',
      invocation: { kind: 'direct' }, parameters: [stringParam('dshMusic/command', 'action', 'ai-busy, ai-idle, play, pause, toggle, next, prev, duck or unduck')],
      cancellation: { parameter: 'signal' },
      result: anyResult('dshMusic/command', 'whether the action was understood'),
    },
  },
};

class NamedInput {
  constructor(parameters, strict) { this.parameters = parameters; this.strict = strict; }
  codec(p) { return this.strict ? p.strictCodec : p.codec; }
  create = () => (this.schema ??= zod.z.strictObject(Object.fromEntries(this.parameters.map((p) => [p.wire, this.codec(p).create().nonoptional()]))));
  get jsonSchema() {
    return { type: 'object', properties: Object.fromEntries(this.parameters.map((p) => [p.wire, { ...this.codec(p).jsonSchema, description: p.description }])), required: this.parameters.map((p) => p.wire), additionalProperties: false };
  }
}

class RemoteInfo {
  constructor(spec) { this.spec = spec; }
  get package() { return this.spec.package; }
  get descriptors() { return this.resolve().descriptors; }
  get methods() { return this.resolve().methods; }
  resolve() {
    if (this.index) return this.index;
    const descriptors = [], methods = Object.create(null);
    for (const [endpoint, def] of Object.entries(this.spec.methods)) {
      const cut = endpoint.indexOf('/');
      const namespace = endpoint.slice(0, cut), method = endpoint.slice(cut + 1);
      const parameters = def.parameters.map((p) => ({ ...p, wire: p.wire ?? p.name }));
      const d = { ...def, id: `${this.spec.package}#${endpoint}`, namespace, method, parameters };
      const inputs = [];
      methods[endpoint] = Object.assign(d, {
        input: (o) => (inputs[o?.strict === true ? 1 : 0] ??= new NamedInput(parameters, o?.strict === true)),
        invoke(remote, input, signal) {
          const values = parameters.map((p) => input[p.wire]);
          if (def.cancellation) values.push(signal);
          const receiver = Reflect.get(remote, namespace);
          return Reflect.get(receiver, method).apply(receiver, values);
        },
      });
      descriptors.push(d);
    }
    return (this.index = { descriptors, methods });
  }
}

const MUSIC_REMOTE = new RemoteInfo(SPEC);
