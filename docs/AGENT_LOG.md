# Registro de agentes

> Bitácora corta y compartida entre los agentes que trabajan en este repo desde
> la misma carpeta raíz: Claude Code y Devin. Una entrada por sesión, al
> cierre. Objetivo: que ninguna sesión nueva arranque sin saber qué se tocó,
> en qué branch, por qué, y qué falta.
>
> No reemplaza los `BITACORA.md` de cada fase (ahí va el detalle técnico de
> cada hito) ni `docs/DECISIONES.md` (ahí van las decisiones de fondo). Esto
> es solo el punto de entrada rápido: "¿qué pasó la última vez, y dónde".
>
> Convención de branches: `cc/<feature>` (Claude Code), `devin/<task>` (Devin).
> Ver [DECISIONES.md § P-2](DECISIONES.md).

Formato de cada entrada:

```
## AAAA-MM-DD — <branch>
Agente: Claude Code | Devin
Qué: <resumen de una línea>
Por qué: <motivo>
Pendiente: <qué queda para la próxima sesión>
```

---

## 2026-09-02 — main

Agente: Claude Code

Qué: se estableció la convención de coordinación entre Claude Code y Devin
(branches `cc/*` / `devin/*`, este archivo, regla de revisión de PRs de
Devin) y se pusheó `main` a `origin` (9 commits pendientes, hasta T16
incluido).

Por qué: se sumó Devin Desktop (plan free) sobre la misma carpeta raíz para
delegar tareas mecánicas; hacía falta una fuente de verdad compartida antes
de que corriera cualquier tarea.

Pendiente: definir el primer hito de la Fase 3 (PolicyRail/Mandato) para
trabajar en `cc/<feature>`.

## 2026-09-02 (2) — main

Agente: Claude Code

Qué: se confirmó que Devin, por defecto, no usa un prefijo `devin/` — sigue
convención de conventional commits (`feature/`, `fix/`, `docs/`, etc.). Se le
indicó explícitamente usar `devin/<task>` en este repo. Ver [DECISIONES.md §
P-2](DECISIONES.md).

Por qué: sin ese prefijo fijo se pierde la señal de "qué agente generó esta
branch" a simple vista, que es la base de la regla de no pisarse.

Pendiente: verificar en la primera tarea real que Devin efectivamente respeta
`devin/<task>` una vez indicado.

## 2026-09-03 — devin/guards-unit-tests (mergeada)

Agente: Devin

Qué: primera tarea de prueba delegada — tests unitarios para
`packages/sdk/src/guards.ts` (`assertTrustedRegistry`,
`credentialHashToBytes`). PR [#1](https://github.com/vicentewolde/AgentPay/pull/1),
revisado por Claude Code (diff + tests corridos en worktree aislado, 16/16
pasan) y mergeado con squash. Branch borrada tras el merge.

Por qué: validar el flujo completo de coordinación (prefijo de branch,
scope acotado, revisión antes de mergear) con una tarea de riesgo mínimo.

Pendiente: Devin respetó el prefijo `devin/` una vez indicado explícitamente
(no es su default). Al delegar la próxima tarea, commitear primero
cualquier cambio propio pendiente en `main` — un `checkout` de Devin en la
carpeta compartida arrastra ediciones sin commitear a su branch (pasó en
esta ronda, sin consecuencias porque se detectó a tiempo).
