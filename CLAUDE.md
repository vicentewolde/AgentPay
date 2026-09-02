# AgentPass — instrucciones de trabajo

Credenciales de identidad para agentes de IA sobre **Stellar testnet**. Un agente
prueba criptográficamente quién lo opera y qué puede hacer, y esa autorización se
puede cortar desde fuera del agente — imposible de saltar por prompt injection.

## Lee esto antes de tocar nada

| | |
|---|---|
| [docs/CONTEXTO.md](docs/CONTEXTO.md) | Qué es el proyecto, la tesis, qué **no** es, fuera de alcance |
| [docs/BITACORA.md](docs/BITACORA.md) | Estado actual, qué hito sigue, qué se hizo en cada uno |
| [docs/DECISIONES.md](docs/DECISIONES.md) | Toda decisión importante, con su motivo y lo que se descartó |
| [README.md](README.md) | Cómo correr el proyecto |

`docs/BITACORA.md` dice en qué hito estamos. Empieza por ahí.

## Reglas de trabajo

1. **Para al cerrar cada hito (T1…T8) y muestra el resultado.** No encadenes
   hitos sin revisión.
2. **No cambies unilateralmente una decisión de `DECISIONES.md`.** Si al
   implementarla parece equivocada: dilo, muestra la evidencia, propón la
   alternativa y **espera**.
3. **Resume en lenguaje llano.** Al cerrar un hito, primero *qué quedó
   funcionando* en palabras que entienda alguien no técnico; después la
   evidencia técnica. Antes de empezar un hito, 3-4 líneas de qué vas a hacer.
4. **Idioma:** documentación del proyecto (`docs/`) en español. Código,
   comentarios, mensajes de commit y `README.md` en inglés.
5. **No construyas lo que está fuera de alcance.** PolicyRail, Mandato,
   MandateGate, MandateVault, enforcement de límites de gasto, cualquier UI web,
   cualquier cosa en mainnet o con rieles fiat. Si el trabajo actual parece
   pedirlo: anótalo y déjalo sin construir.

## Al cerrar cada hito

1. Actualiza **Estado actual** y la tabla de progreso en `docs/BITACORA.md`, y
   agrega el bloque del hito en lenguaje llano.
2. Agrega las salidas crudas en `docs/evidencia/T<n>.md`.
3. Agrega toda decisión nueva a `docs/DECISIONES.md` con motivo y alternativa
   descartada.
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
pnpm typecheck
```

```bash
pnpm test
```

```bash
cd contracts && cargo test
```

`rustup` viene de Homebrew y es keg-only; hace falta
`export PATH="/opt/homebrew/opt/rustup/bin:$PATH"` para que exista `cargo`.
