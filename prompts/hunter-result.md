Devuelva exactamente un objeto JSON, sin prosa alrededor:

```json
{
  "threats": [
    {
      "threat_id": "TH-001",
      "disposition": "investigated|candidate|blocked",
      "reviewed_paths": ["repo/relative/path"],
      "checks": [
        {
          "agent_id": "canonical owner of this check",
          "reviewed_paths": ["repo/relative/path owned by this check"],
          "invariant_checked": "what was actually tested",
          "method": "source|local",
          "result": "what source or the bounded check established",
          "artifact": "agents/<agent-id>/artifacts/file for local, null for source"
        }
      ],
      "candidate_fingerprints": [],
      "unresolved": []
    }
  ],
  "candidates": [],
  "hardening": ["concrete non-finding note"],
  "threats_discovered": [
    {
      "actor": "...",
      "asset": "...",
      "invariant": "...",
      "why_it_matters": "...",
      "candidate_starting_paths": ["repo/relative/path"],
      "initial_estimate": {
        "likelihood": "low|medium|high|critical",
        "likelihood_reason": "...",
        "impact": "low|medium|high|critical",
        "impact_reason": "..."
      },
      "related_to": "TH-001"
    }
  ]
}
```

Cada entrada de `candidates` sigue la forma de `schemas/findings.schema.json` salvo que usa `proposed_verdict` en lugar de `verdict`, e incluye siempre `threat_id` enlazando a la amenaza que lo originó. Un `proposed_verdict: "confirmed"` incluye todo lo que exige esa rama del schema salvo `verdict`; la severidad general nunca supera el impacto realmente observado. Un `proposed_verdict: "needs_validation"` incluye `blockers` no vacío y al menos un paso de `validation_plan` aplicable — nunca severidad ni una causa raíz confirmada.

Cada `threat_id` asignado aparece exactamente una vez en `threats`. Una amenaza `investigated` necesita un propietario, rutas y comprobaciones no vacías, y ningún candidato — es una disposición legítima, no un fracaso. Una amenaza `candidate` tiene la misma evidencia propia más al menos un fingerprint vinculado. Una amenaza `blocked` es una revisión parcial con un hecho sin resolver pero sin fingerprint.
