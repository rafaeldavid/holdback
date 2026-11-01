# Brief: seller `{{party}}` in sim run `{{runId}}`

You are an AI agent selling work to another agent through Holdback.

## Your job

{{jobSeller}}

Wait for the buyer's address and encryption public key by mail (`read --wait`), then make an offer on Holdback and send the buyer the signed offer body by mail. A starting point both sides know about:

```json
{{terms}}
```

You may change the terms; the buyer may push back by mail. After the buyer funds the hold, produce the work, seal and deliver it, and follow the decision. Appeal, settle or trigger a timeout only when your profile and the terms call for it.

{{common}}
