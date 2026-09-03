# Contexto — Fase 3 (PolicyRail + Mandato)

> Qué prueba esta fase, qué **no** es, y qué queda deliberadamente afuera.
> Especificación: [ROADMAP.md §4.3](../../ROADMAP.md) ·
> Mapa técnico: [ARQUITECTURA.md](ARQUITECTURA.md) ·
> Estado: [BITACORA.md](BITACORA.md) · Decisiones: [DECISIONES.md](DECISIONES.md)

---

## 1. La frase

> Un límite de gasto no vive en las instrucciones del agente, sino en un lugar
> que el agente no puede reescribir aunque se lo pidan con éxito. Y el
> consentimiento de quien pone la plata es una estructura firmada y
> verificable, no una casilla marcada en una UI.

## 2. Qué faltaba, exactamente

Al cerrar la Fase 2 el proyecto tenía tres afirmaciones firmadas y una ausencia:

| documento | quién lo firma | qué dice | fase |
|---|---|---|---|
| Credencial AgentPass | el **emisor** | quién es este agente y qué cree su emisor que puede hacer | 1 |
| `PurchaseIntent` | el **agente** | qué quiere hacer ahora mismo | 2 |
| **Mandato** | el **principal** | *yo autorizo a este agente a gastar hasta esto, acá, en esto, hasta esta fecha* | **3** |

La ausencia era la tercera fila. Sin ella, "el principal autorizó esto" era una
suposición del sistema, no un documento que alguien pudiera revisar después.

Y una segunda ausencia, del lado del enforcement: `scope.limits` viajaba
firmado desde la Fase 1 pero **nada lo hacía cumplir** (`A-7`). La Fase 2 aplicó
`perTx` en el chequeo de alcance y dejó `perDay` explícitamente sin aplicar
(`B-16`), porque un total diario necesita memoria de gastos pasados — eso es
enforcement con estado, y es trabajo de esta fase.

## 3. Por qué las dos cosas van juntas

No es una agrupación de conveniencia. **Mandato es el objeto que PolicyRail
necesita para saber qué límites aplicar y a nombre de quién.** Un PolicyRail sin
Mandato aplicaría límites que alguien dejó en un archivo de configuración; un
Mandato sin PolicyRail sería un documento precioso que nada obliga a respetar.

## 4. Qué NO es esta fase

- **No es un sistema de pagos.** Sigue sin moverse dinero. Un `PurchaseIntent`
  autorizado por un Mandato sigue siendo una intención, no una transferencia.
- **No es MandateGate.** Meter esta cadena dentro del checkout real de un
  tercero es la Fase 4, y depende de una superficie que este repo no controla.
- **No es MandateVault.** Dejar cada decisión como evidencia consultable en
  cadena es la Fase 5.
- **No es una UI.** No hay pantalla donde un principal firme un mandato. El
  documento se arma y se firma por código; la interfaz humana no es el problema
  que esta fase resuelve, y construirla escondería que el problema es el
  documento, no el botón.

## 5. El bloqueante externo, y qué se decidió hacer con él

Las diez preguntas al embajador ([ROADMAP.md §4.2](../../ROADMAP.md)) siguen sin
respuesta. La **pregunta 6** —¿el comprador puede ser una cuenta de contrato
(`C...`) o solo una clásica (`G...`)?— decide si PolicyRail puede vivir on-chain
como *smart account* o tiene que ser middleware off-chain.

Se decidió **no esperarla**, y se decidió cómo no esperarla: ver `M-1`. Todo lo
que no depende de esa respuesta se construye completo; lo que sí depende queda
aislado detrás de un puerto y se declara, no se simula. Es el mismo patrón con
el que la Fase 2 cerró T9–T14 dejando T15 abierto.

## 6. Fuera de alcance, a propósito

MandateGate (Fase 4) · MandateVault (Fase 5) · cualquier UI web · Stellar
mainnet · rieles fiat o PSP · cualquier movimiento real de fondos · límites
expresados en algo que no sea el `scope` que la Fase 1 ya definió.
