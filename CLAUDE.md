# AgentPay — instrucciones de trabajo

Pila de pagos agénticos sobre **Stellar testnet**, en siete fases. La Fase 1
(**AgentPass**) está cerrada: un agente prueba criptográficamente quién lo opera
y qué puede hacer, y esa autorización se puede cortar desde fuera del agente —
imposible de saltar por prompt injection.

## Lee esto antes de tocar nada

| | |
|---|---|
| [ROADMAP.md](ROADMAP.md) | **Empieza aquí.** Las siete fases, en cuál estamos, qué sigue |
| [docs/DECISIONES.md](docs/DECISIONES.md) | Decisiones que cruzan fases o afectan la estructura del proyecto (prefijo `P-`) |
| [docs/fase-1-agentpass/CONTEXTO.md](docs/fase-1-agentpass/CONTEXTO.md) | Qué es el proyecto, la tesis, qué **no** es, fuera de alcance |
| [docs/fase-1-agentpass/ARQUITECTURA.md](docs/fase-1-agentpass/ARQUITECTURA.md) | Mapa técnico denso y autocontenido — para dar contexto a un chat nuevo sin que lea el código |
| [docs/fase-1-agentpass/BITACORA.md](docs/fase-1-agentpass/BITACORA.md) | Estado actual, qué hito sigue, qué se hizo en cada uno |
| [docs/fase-1-agentpass/DECISIONES.md](docs/fase-1-agentpass/DECISIONES.md) | Toda decisión importante, con su motivo y lo que se descartó |
| [docs/fase-2-agente-compra/ARQUITECTURA.md](docs/fase-2-agente-compra/ARQUITECTURA.md) | Mapa técnico de la Fase 2: catálogo, herramientas, verificación de credencial, scope, forma del `PurchaseIntent` |
| [docs/fase-2-agente-compra/BITACORA.md](docs/fase-2-agente-compra/BITACORA.md) | **Cerrada, T9–T15.** Estado actual y qué se hizo en cada hito |
| [docs/fase-2-agente-compra/DECISIONES.md](docs/fase-2-agente-compra/DECISIONES.md) | Decisiones de la Fase 2 (prefijo `B-`) |
| [docs/fase-3-policyrail-mandato/CONTEXTO.md](docs/fase-3-policyrail-mandato/CONTEXTO.md) | **Cerrada.** Qué prueba, qué no es, el bloqueante externo y qué se decidió hacer con él |
| [docs/fase-3-policyrail-mandato/ARQUITECTURA.md](docs/fase-3-policyrail-mandato/ARQUITECTURA.md) | Mapa técnico de la Fase 3: los tres documentos firmados, la forma del Mandato, dónde vive el enforcement |
| [docs/fase-3-policyrail-mandato/BITACORA.md](docs/fase-3-policyrail-mandato/BITACORA.md) | **Cerrada, T16–T23.** Estado actual y qué sigue |
| [docs/fase-3-policyrail-mandato/DECISIONES.md](docs/fase-3-policyrail-mandato/DECISIONES.md) | Decisiones de la Fase 3 (prefijo `M-`). `M-1` quedó **superada** en T19; `M-11` y `M-12` la reemplazan |
| [docs/fase-4-mandategate/CONTEXTO.md](docs/fase-4-mandategate/CONTEXTO.md) | **Fase en curso.** Qué prueba, qué no es, qué cambió del alcance documentado y por qué |
| [docs/fase-4-mandategate/ARQUITECTURA.md](docs/fase-4-mandategate/ARQUITECTURA.md) | Mapa técnico de la Fase 4: el módulo de pago x402, identidades resueltas contra tráfico real |
| [docs/fase-4-mandategate/BITACORA.md](docs/fase-4-mandategate/BITACORA.md) | **T24–T26 cerrados.** Estado actual y qué sigue |
| [docs/fase-4-mandategate/DECISIONES.md](docs/fase-4-mandategate/DECISIONES.md) | Decisiones de la Fase 4 (prefijo `G-`) |
| [docs/fase-5-mandatevault/CONTEXTO.md](docs/fase-5-mandatevault/CONTEXTO.md) | **Fase en curso.** Qué prueba, qué no es, qué cambió del alcance documentado y por qué |
| [docs/fase-5-mandatevault/ARQUITECTURA.md](docs/fase-5-mandatevault/ARQUITECTURA.md) | Mapa técnico de la Fase 5: el paquete `@agentpay/vault`, la cadena de hashes, el seam de `policyRail?` |
| [docs/fase-5-mandatevault/BITACORA.md](docs/fase-5-mandatevault/BITACORA.md) | **T27–T31 cerrados.** Estado actual y qué sigue |
| [docs/fase-5-mandatevault/DECISIONES.md](docs/fase-5-mandatevault/DECISIONES.md) | Decisiones de la Fase 5 (prefijo `V-`) |
| [docs/AGENT_LOG.md](docs/AGENT_LOG.md) | **Leer siempre, antes de tocar nada.** Bitácora corta compartida entre Claude Code y Codex: qué se hizo, en qué branch, qué queda pendiente |
| [docs/fase-0-fundamentos/metodologia-claude-codex.html](docs/fase-0-fundamentos/metodologia-claude-codex.html) | Resumen visual del protocolo de coordinación Claude Code ↔ Codex — roles, el ciclo vía git, qué hace el usuario en cada punto. Abrir en el navegador |
| [README.md](README.md) | Cómo correr el proyecto |

`ROADMAP.md` dice en qué fase estamos; dentro de una fase cerrada, su
`BITACORA.md` dice qué se hizo hito a hito.

## Reglas de trabajo

1. **Para al cerrar cada hito y muestra el resultado.** No encadenes hitos sin
   revisión. La numeración es continua entre fases: T1–T8 fue la Fase 1,
   T9–T15 es la Fase 2.
2. **No cambies unilateralmente una decisión de `DECISIONES.md`.** Si al
   implementarla parece equivocada: dilo, muestra la evidencia, propón la
   alternativa y **espera**.
3. **Resume en lenguaje llano.** Al cerrar un hito, primero *qué quedó
   funcionando* en palabras que entienda alguien no técnico; después la
   evidencia técnica. Antes de empezar un hito, 3-4 líneas de qué vas a hacer.
4. **Idioma:** documentación del proyecto (`docs/`) en español. Código,
   comentarios, mensajes de commit y `README.md` en inglés.
5. **No construyas lo que está fuera de alcance.** PolicyRail y Mandato
   —incluido el enforcement de `scope.limits`— entraron en alcance con la Fase
   3 (cerrada). MandateGate (pagos x402 reales), un frontend simple y
   `execute_payment` (la tool de pago del agente) entraron en alcance con la
   Fase 4 (cerrada, T24–T26) — ver `docs/fase-4-mandategate/CONTEXTO.md` §5 y
   `DECISIONES.md` → `G-12`. **MandateVault entró en alcance el 2026-09-04, a
   pedido explícito del usuario** — Fase 5, ver `ROADMAP.md` §4.5. `policy_rail`
   como pagador real en testnet entró en alcance el 2026-09-04 (T31), también a
   pedido explícito del usuario. Sigue fuera:
   la ejecución de negocio del piloto (cohorte de alumnos, comunidad aliada,
   demo grabable, formulario de Build Award) todavía no arrancó y no es
   trabajo de código; cualquier cosa en mainnet o con rieles fiat. Si el
   trabajo actual parece pedir algo de lo que sigue fuera: anótalo y déjalo
   sin construir.

## Coordinación con Codex — protocolo obligatorio, no opcional

Codex (OpenAI, incluido en ChatGPT Plus) trabaja como segundo agente, en
tareas mecánicas y acotadas. Reemplaza a Devin, discontinuado por calidad
insuficiente en su plan free — ver [docs/DECISIONES.md § P-4](docs/DECISIONES.md),
que también deja registrado por qué el protocolo con Codex es más estricto
que el que tuvo Devin: con Devin hubo un bypass de seguridad real en una rama
huérfana (`checkMandate`, ver
[fase-2/DECISIONES.md § B-25](docs/fase-2-agente-compra/DECISIONES.md)) y dos
episodios de colisión de branches por compartir la misma carpeta de disco —
uno con Devin (`docs/AGENT_LOG.md`, 2026-09-03) y otro con Codex
(`docs/AGENT_LOG.md`, 2026-09-07). Por eso Codex opera en su propio
**worktree** (`~/dev/AgentPay-codex`), no en esta carpeta — ver
[docs/DECISIONES.md § P-5](docs/DECISIONES.md). Lo que sigue es el checklist
que **toda sesión de Claude Code corre, siempre**, para que ninguna de las
dos herramientas pise trabajo de la otra ni pierda contexto:

1. **Antes de tocar cualquier archivo:** `git status` y `git log --oneline -10`.
   Codex trabaja en su propio worktree, pero comparte el mismo historial de
   git — nada se asume "al día" solo porque `origin/main` no cambió desde acá.
2. **Leé [docs/AGENT_LOG.md](docs/AGENT_LOG.md) primero.** Dice qué pasó la
   última vez, en qué branch, y qué falta — de cualquiera de los dos agentes.
3. **Todo el trabajo de Claude Code va en una rama `cc/<feature>`, y todo el
   de Codex en `codex/<task>` — nunca directo a `main`.** Al cerrar el hito,
   mergeá a `main` (fast-forward si se puede) y borrá la rama.
4. **Antes de delegarle una tarea a Codex:** no hace falta commitear nada
   propio pendiente por el riesgo de que un `checkout` ajeno lo arrastre —
   worktrees separados ya lo resuelven (`P-5`). Sí conviene pushear cualquier
   cosa que Codex necesite ver en `origin/main` antes de arrancarlo, porque su
   worktree parte de ahí, no de tu carpeta.
5. **Todo PR o diff que venga de Codex se revisa antes de mergear** — diff
   completo y tests corridos, idealmente en un worktree aislado. Nunca se
   mergea a ciegas. Prestá atención particular a cualquier cambio, directo o
   indirecto, a `checkMandate`, al enforcement de `scope.limits`/`perDay`, o a
   cualquier punto de autorización — el precedente de `B-25` es exactamente
   ese tipo de bug.
6. **Contratos (AgentPass, PolicyRail, Mandato), MandateVault, la integración
   con el bazaar del embajador, y cualquier decisión que afecte la narrativa
   de la postulación a SCF se quedan en Claude Code.** No se delegan a Codex
   sin que el usuario o Claude Code den el visto bueno explícito primero —
   Codex no tiene ese contexto regulatorio ni narrativo.
7. **Al cerrar cualquier sesión o hito, agregá una entrada a
   `docs/AGENT_LOG.md`** antes de terminar: branch, qué, por qué, qué queda
   pendiente. Esto no es opcional ni algo para hacer "si da tiempo" — es lo
   que evita que la próxima sesión, sea de Claude Code o de Codex, arranque a
   ciegas.

## Al cerrar cada hito

1. Actualiza **Estado actual** y la tabla de progreso en el `BITACORA.md` de la
   fase en curso, y agrega el bloque del hito en lenguaje llano.
2. Agrega las salidas crudas en `evidencia/T<n>.md` de esa misma fase.
3. Agrega toda decisión nueva al `DECISIONES.md` de la fase en curso, con motivo
   y alternativa descartada. Si la decisión afecta a más de una fase o a la
   estructura del proyecto, va a `docs/DECISIONES.md` con prefijo `P-`.
4. Commit con mensaje que explique el **porqué**, no solo el qué.

## Criterios transversales (no negociables)

- Errores tipados y distinguibles vía `AgentPassError` + `code`. **Nunca**
  `throw new Error("...")` genérico, nunca devolver `undefined` en un fallo.
- Todo dato que cruza un borde pasa por **zod**. Nada de `any`.
- Sin credenciales hardcodeadas. Todo por `.env.local`; `.env.example` versionado.
- Cada README documenta el **comando exacto**, no una descripción del comando.

## Comandos

```bash
pnpm install
```

```bash
pnpm run bootstrap
```

```bash
pnpm run deploy:registry
```

```bash
pnpm build
```

```bash
pnpm typecheck
```

```bash
pnpm test
```

```bash
pnpm run test:integration
```

```bash
cd contracts && cargo test
```

`rustup` viene de Homebrew y es keg-only; hace falta
`export PATH="/opt/homebrew/opt/rustup/bin:$PATH"` para que exista `cargo`.

`pnpm test` no toca la red. `test:integration` sí — corre el ciclo completo
contra testnet real y necesita `.env.local` con el contrato desplegado.

El binario del CLI, tras `pnpm build`, se invoca como
`node packages/cli/dist/bin.js <comando>`. El recorrido completo (emitir →
verificar → revocar → verificar falla) está en el README raíz, sección
"Full walkthrough".
