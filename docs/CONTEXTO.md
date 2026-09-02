# AgentPass — contexto del proyecto

> **Qué** es AgentPass y **por qué** existe.
> Para el avance: [BITACORA.md](BITACORA.md) · Para el porqué técnico: [DECISIONES.md](DECISIONES.md)

Última revisión: 2026-09-01

---

## El problema

Un agente de IA que actúa por ti —que compra, contrata o gasta— hoy no tiene
forma de probar dos cosas ante un tercero:

1. **Quién lo opera.** El comercio del otro lado ve una petición HTTP. No sabe
   si detrás hay una empresa real, un experimento, o alguien haciéndose pasar
   por otro.
2. **Qué está autorizado a hacer.** No hay nada que diga "este agente puede leer
   catálogo y crear intenciones de compra, pero no puede pagar más de 50 USDC".

Y hay un problema peor debajo: **si la autorización vive dentro del prompt del
agente, cualquiera que logre inyectar texto en ese prompt puede reescribirla.**
Un agente al que le dicen "ignora tus límites anteriores" y obedece, no tenía
límites. La autorización tiene que vivir *fuera* del agente, donde el agente no
pueda tocarla.

## La tesis

> Un agente de IA debe poder probar criptográficamente quién lo opera y qué está
> autorizado a hacer, y esa autorización debe poder cortarse desde fuera del
> agente — imposible de saltar por prompt injection.

## Cómo funciona, en tres pasos

**1. Emisión.** Un principal (persona o empresa) firma una credencial que dice
"este agente es mío, se llama así, corre este modelo, y puede hacer estas cosas
con estos límites". La firma es criptográfica: nadie puede falsificarla sin la
llave privada del principal.

**2. Anclaje.** De esa credencial, solo su **huella digital** (un SHA-256) se
publica en la blockchain de Stellar, junto con su estado: activa o revocada. La
credencial completa nunca se publica.

**3. Verificación.** Cualquiera que reciba la credencial hace tres chequeos:

| # | Chequeo | ¿Necesita red? |
|---|---|---|
| 1 | ¿La firma corresponde al emisor que dice ser? | **No** |
| 2 | ¿Estamos dentro de su ventana de validez? | **No** |
| 3 | ¿La huella sigue activa en el registro y el emisor sigue habilitado? | Sí |

Los dos primeros funcionan sin conexión porque la dirección Stellar del emisor
**es** su llave pública. No hay que preguntarle a nadie quién es.

El tercero es el que hace posible **cortar la autorización desde afuera**: el
principal revoca la credencial en el contrato, y a partir de ese momento toda
verificación falla. El agente no puede impedirlo, no puede detectarlo, y no hay
prompt que lo revierta. Esa es la propiedad central del producto.

## Por qué la credencial no va en la blockchain

Porque contiene datos del operador y del alcance de un agente, y una blockchain
es pública y permanente. Publicar la huella basta para probar que la credencial
existía, y para poder revocarla. Publicar el contenido sería regalar información
sin obtener nada a cambio.

## Qué NO es AgentPass

- **No es un sistema de pagos.** No mueve dinero. Solo dice quién es quién.
- **No hace cumplir los límites de gasto todavía.** El campo `scope.limits` se
  firma y viaja dentro de la credencial, pero en esta fase **nada lo aplica**.
  Es declarativo a propósito: primero la identidad, después el enforcement.
- **No toca dinero real.** Todo corre en Stellar **testnet**.

## Restricciones no negociables

| | |
|---|---|
| Red | Stellar **testnet** únicamente. Nada de mainnet, rieles fiat ni PSP. |
| Plazo | Piloto de 10 semanas. Velocidad de iteración sobre arquitectura perfecta. |
| Dependencias | Nada de JSON-LD pesado ni suites criptográficas exóticas. |

## Piezas futuras — nombradas, no construidas

AgentPass es la primera pieza de una pila de *agentic payments*. Después vienen
**PolicyRail**, **Mandato**, **MandateGate** y **MandateVault**.

**No se construyen ni se anticipan ahora.** Si algo del trabajo actual parece
pedir una de estas piezas, la respuesta correcta es anotarlo y dejarlo sin
construir.
