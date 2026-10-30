# Parses the stateDiagram in docs/architecture.md and checks two things.
import re,sys,collections
src=open('docs/architecture.md').read()
body=src.split('stateDiagram-v2')[1].split('```')[0]
edges=collections.defaultdict(list)
for m in re.finditer(r'(\w+|\[\*\]) --> (\w+): ?(.*)',body):
    edges[m.group(1)].append((m.group(2),m.group(3).strip()))
# 1. Escalation path where the appeal adjudicator never decides: only 'deadline' edges allowed out of Appealed
print("Edges out of Escalated:",edges['Escalated'])
print("Edges out of Appealed :",edges['Appealed'])
print("Edges out of Final    :",edges['Final'] or 'NONE (terminal, funds still held, no prior decision to stand)')
print("States that reach Defaulted:",[s for s,e in edges.items() if any(t=='Defaulted' for t,_ in e)])
# 2. Rejected -> Held under guaranteed_on_decision (refund executes at the decision)
print("Edges out of Rejected :",edges['Rejected'])
