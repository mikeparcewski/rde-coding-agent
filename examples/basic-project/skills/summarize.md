---
name: /summarize
description: Summarize a piece of text to a target length
parameters:
  text:
    type: string
    description: The text to summarize
    required: true
  length:
    type: string
    description: "Target length: short | medium | long"
    required: false
---

Summarize the following text.
Target length: {{length | "medium"}}.

Text:
{{text}}
