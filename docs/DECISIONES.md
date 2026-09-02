# Decisiones del proyecto

> Registro de decisiones que afectan a **más de una fase** o a la estructura del
> proyecto completo. Una entrada por decisión, con su motivo y la alternativa
> que se descartó. **No se borran entradas**: si una decisión se revierte, se
> marca como `Superada` y se agrega la nueva.
>
> **Prefijo `P-`** (proyecto), para que nunca se confundan con las decisiones de
> una fase concreta. Las de la Fase 1 viven aparte, en
> [fase-1-agentpass/DECISIONES.md](fase-1-agentpass/DECISIONES.md), con sus
> prefijos `A-` (brief original) e `I-` (implementación).
>
> Plan maestro: [../ROADMAP.md](../ROADMAP.md)

Estados: `Vigente` · `Superada` · `Pendiente`

---

### P-1 · Monorepo único para las siete fases, AgentPass fusionado con su historia completa · `Vigente`
**Fecha:** 2026-09-02

Todo el proyecto AgentPay vive en un solo repositorio público. AgentPass, que
era un repositorio propio anidado, se fusionó en la raíz **preservando sus diez
commits como ancestros reales** de la historia (`git merge
--allow-unrelated-histories`), no copiando archivos. `packages/`, `contracts/`,
`deployments/`, `examples/` y `scripts/` quedan en la raíz: las fases siguientes
agregan hermanos ahí adentro, no carpetas paralelas.

**Motivo.** Tres razones concretas, no preferencia estética:

1. **Código compartido real.** El módulo de identidad DID/VC-JWT que ya existe
   en `packages/core` es exactamente lo que Mandato va a reutilizar. Con repos
   separados eso sería una dependencia publicada o un submódulo; aquí es un
   import.
2. **Estado compartido.** `deployments/testnet.json` es el único artefacto que
   cruza la frontera TypeScript↔Rust, y va a crecer con los contratos de
   PolicyRail y Mandato. Un solo archivo, un solo repo.
3. **La historia de commits es evidencia.** La postulación a Stellar Community
   Fund se apoya en historial de ejecución verificable. Fragmentado en cinco
   repos, ese historial pierde fuerza: nadie reconstruye la secuencia real de
   trabajo saltando entre repositorios.

**Alternativa descartada:** un repositorio por fase. Habría dado aislamiento
más limpio entre fases y despliegues independientes, pero a costa de las tres
razones de arriba — y ninguna fase es un producto separable, todas son capas de
la misma pila.

**Documentación separada por fase.** Se optó por `docs/fase-N-nombre/` en vez de
extender los mismos cuatro archivos a todo AgentPay. El `ROADMAP.md` original
recomendaba lo contrario (mantener un `DECISIONES.md` histórico único); se
decidió al revés porque un solo `BITACORA.md` cubriendo siete fases se vuelve
ilegible mucho antes de terminar, y porque el corte por fase deja obvio qué
documentación está cerrada y cuál está viva. Las decisiones que cruzan fases
—como esta— tienen este archivo.

**Supersede a `I-13`** (`Repo privado en GitHub`, en el registro de la Fase 1),
que queda desactualizada. Esa entrada no se edita: el registro de una fase
cerrada no se reescribe hacia atrás, se supersede desde aquí.
