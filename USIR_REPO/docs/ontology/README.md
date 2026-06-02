# Ontology Proposals

This directory is open for community proposals for extending the Universal Intent Ontology.

## How to submit a proposal

1. Fork the repository
2. Create a new file in `proposals/` named with a short descriptor, e.g. `proposals/mood-expression.md`
3. Include:
   - Use case description
   - Why existing intent types don't cover it
   - Proposed `type` string and payload interface
4. Open a Pull Request

## Review process

1. Proposals are reviewed by maintainers within 14 days
2. Community discussion period: minimum 7 days
3. If consensus is reached, the type is added to the next minor version of the ontology spec
4. If not, the proposal is marked as `deferred` with notes

## Existing areas known to need proposals

- **Spatial/XR verbs** — anchor, pin, resize, rotate (for AR/VR interaction)
- **IoT verbs** — dim, lock, arm, setThermostat (for physical device control)
- **Health/wellness** — log, measure, remind (quantified self use cases)
- **Game verbs** — equip, cast, trade (for in-game interaction)
