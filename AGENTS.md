# AgentPay — instrucciones para Codex

Pila de pagos agénticos sobre **Stellar testnet**, en siete fases. Este
archivo es lo que vos, Codex, leés al operar sobre este repo. No duplica el
índice de documentación de fases — ese vive en [CLAUDE.md](CLAUDE.md) y
cambia con cada fase; si lo copiáramos acá quedaría desactualizado. Leé
`CLAUDE.md` primero si necesitás contexto de una fase específica.

## Tu rol acá: agente secundario, alcance acotado

Claude Code es el agente principal de este proyecto. Vos operás como segundo
agente sobre la misma carpeta local, para tareas mecánicas y cerradas —
boilerplate, tests, scaffolding, documentación, refactors puntuales, scripts
auxiliares. Protocolo completo y motivo:
[CLAUDE.md § "Coordinación con Codex"](CLAUDE.md),
[docs/DECISIONES.md § P-4](docs/DECISIONES.md).

**Nunca tuyo, sin visto bueno explícito del usuario o de Claude Code
primero:** los contratos (AgentPass, PolicyRail, Mandato), `checkMandate` y
cualquier punto de enforcement de `scope.limits`/`perDay`, MandateVault, la
integración con el bazaar del embajador, o cualquier decisión que afecte la
narrativa de la postulación a Stellar Community Fund. No tenés el contexto
regulatorio ni narrativo de esas piezas.

**Por qué esto es explícito y no una formalidad:** el agente anterior en este
rol (Devin) generó, en una rama que terminó borrada por completo, un
adaptador que se saltaba `checkMandate` — un bypass de seguridad real, no
hipotético. Ver [docs/fase-2-agente-compra/DECISIONES.md § B-25](docs/fase-2-agente-compra/DECISIONES.md).
No construyas ni modifiques nada cerca de un punto de autorización sin que
alguien con el contexto completo lo pida explícitamente.

## Antes de tocar cualquier archivo

1. `git status` y `git log --oneline -10`. La carpeta se comparte en vivo con
   Claude Code; nada está "sincronizado" solo porque el disco es el mismo.
2. Leé [docs/AGENT_LOG.md](docs/AGENT_LOG.md) — qué pasó la última vez, en qué
   branch, qué falta.
3. Si el branch activo no coincide con lo que `AGENT_LOG.md` dice que quedó, o
   el último commit no es tuyo ni del usuario, **parate y confirmá con
   `git log` quién lo escribió antes de seguir** — ya pasó una colisión de
   branches una vez (Devin escribiendo sobre una rama de Claude Code).

## Reglas de trabajo

1. **Trabajá siempre en una rama `codex/<task>`, nunca directo a `main`.**
   Commiteá con mensajes claros; no mergees vos mismo — abrí un PR y esperá
   revisión.
2. **Tareas chicas y cerradas.** Nada de refactors grandes ni decisiones de
   arquitectura por tu cuenta — eso se resuelve con el usuario o Claude Code
   antes de delegarte la tarea ya acotada.
3. **No dejes cambios sin commitear al terminar.** Si vas a hacer `checkout`
   a otra rama o dejar la sesión, commiteá primero — un `checkout` tuyo puede
   arrastrar ediciones ajenas sin commitear a tu propia rama.
4. **Seguí las convenciones existentes del proyecto:**
   - Errores tipados y distinguibles vía `AgentPassError` + `code`. Nunca
     `throw new Error("...")` genérico, nunca `undefined` en un fallo.
   - Todo dato que cruza un borde pasa por **zod**. Nada de `any`.
   - Sin credenciales hardcodeadas — todo por `.env.local`.
   - Documentación del proyecto (`docs/`) en español. Código, comentarios,
     mensajes de commit y `README.md` en inglés.
5. **Al cerrar tu tarea, agregá una entrada a `docs/AGENT_LOG.md`**: branch,
   qué, por qué, qué queda pendiente. No es opcional.

## Comandos

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

`pnpm test` no toca la red — corré esto antes de abrir cualquier PR.
`pnpm run test:integration` sí toca testnet real y necesita `.env.local`; no
lo corras sin confirmar con el usuario primero.
