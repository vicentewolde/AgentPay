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
| [docs/fase-2-agente-compra/BITACORA.md](docs/fase-2-agente-compra/BITACORA.md) | **T9–T14 cerrados** (T15 desbloqueado en T19, sin construir). Estado actual y qué se hizo en cada hito |
| [docs/fase-2-agente-compra/DECISIONES.md](docs/fase-2-agente-compra/DECISIONES.md) | Decisiones de la Fase 2 (prefijo `B-`) |
| [docs/fase-3-policyrail-mandato/CONTEXTO.md](docs/fase-3-policyrail-mandato/CONTEXTO.md) | **Fase en curso.** Qué prueba, qué no es, el bloqueante externo y qué se decidió hacer con él |
| [docs/fase-3-policyrail-mandato/ARQUITECTURA.md](docs/fase-3-policyrail-mandato/ARQUITECTURA.md) | Mapa técnico de la Fase 3: los tres documentos firmados, la forma del Mandato, dónde vive el enforcement |
| [docs/fase-3-policyrail-mandato/BITACORA.md](docs/fase-3-policyrail-mandato/BITACORA.md) | **T16–T19 cerrados.** Estado actual y qué sigue |
| [docs/fase-3-policyrail-mandato/DECISIONES.md](docs/fase-3-policyrail-mandato/DECISIONES.md) | Decisiones de la Fase 3 (prefijo `M-`). `M-1` quedó **superada** en T19; `M-11` y `M-12` la reemplazan |
| [docs/AGENT_LOG.md](docs/AGENT_LOG.md) | **Leer siempre, antes de tocar nada.** Bitácora corta compartida entre Claude Code y Devin: qué se hizo, en qué branch, qué queda pendiente |
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
   —incluido el enforcement de `scope.limits`— **entran en alcance con la Fase
   3**, que es la fase en curso. Siguen fuera: MandateGate (Fase 4),
   MandateVault (Fase 5), cualquier UI web, cualquier cosa en mainnet o con
   rieles fiat. Si el trabajo actual parece pedir algo de lo que sigue fuera:
   anótalo y déjalo sin construir.

## Coordinación con Devin — protocolo obligatorio, no opcional

Devin (plan free) trabaja como segundo agente sobre esta misma carpeta local,
en tareas mecánicas y acotadas. Motivo completo y alternativas descartadas:
[docs/DECISIONES.md § P-2](docs/DECISIONES.md). Lo que sigue es el checklist
que **toda sesión de Claude Code corre, siempre**, para que ninguna de las dos
herramientas pise trabajo de la otra ni pierda contexto:

1. **Antes de tocar cualquier archivo:** `git status` y `git log --oneline -10`.
   La carpeta se comparte en vivo con Devin; nada se asume "sincronizado" solo
   porque el disco es el mismo. Si hay cambios sin commitear que no son tuyos
   de esta sesión, no los pises — investigá primero (regla general de este
   proyecto, ver arriba).
2. **Leé [docs/AGENT_LOG.md](docs/AGENT_LOG.md) primero.** Dice qué pasó la
   última vez, en qué branch, y qué falta — de cualquiera de los dos agentes.
3. **Todo el trabajo de Claude Code va en una rama `cc/<feature>`, nunca
   directo a `main`.** Al cerrar el hito, mergeá a `main` (fast-forward si se
   puede) y borrá la rama. `main` es donde ambos agentes coinciden; una rama
   con nombre dice de un vistazo quién la generó.
4. **Antes de delegarle una tarea a Devin, o si Devin va a hacer `checkout` en
   esta carpeta:** commiteá cualquier cambio propio pendiente. Un `checkout`
   de Devin arrastra ediciones sin commitear a su propia branch — ya pasó una
   vez (ver `AGENT_LOG.md`, entrada de `devin/guards-unit-tests`).
5. **Todo PR o diff que venga de Devin se revisa antes de mergear** — diff
   completo y tests corridos, idealmente en un worktree aislado. Nunca se
   mergea a ciegas.
6. **Contratos (AgentPass, PolicyRail, Mandato), MandateVault, la integración
   con el bazaar del embajador, y cualquier decisión que afecte la narrativa
   de la postulación a SCF se quedan en Claude Code.** No se delegan a Devin
   sin que el usuario o Claude Code den el visto bueno explícito primero —
   Devin no tiene ese contexto regulatorio ni narrativo.
7. **Al cerrar cualquier sesión o hito, agregá una entrada a
   `docs/AGENT_LOG.md`** antes de terminar: branch, qué, por qué, qué queda
   pendiente. Esto no es opcional ni algo para hacer "si da tiempo" — es lo
   que evita que la próxima sesión, sea de Claude Code o de Devin, arranque a
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
