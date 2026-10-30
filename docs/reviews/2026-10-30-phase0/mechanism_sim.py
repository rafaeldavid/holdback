# Models CPP AuthCaptureEscrow v1.1.0 (ace.sol) + docs/architecture.md state machine/postings.
import re, itertools
MAXBPS=10000
class Rev(Exception): pass
class CPP:
    def __init__(s): s.st={}; s.bal={}
    def mv(s,a,b,x):
        if s.bal.get(a,0)<x: raise Rev(f"insufficient {a}")
        s.bal[a]-=x; s.bal[b]=s.bal.get(b,0)+x
    def fee(s,pi,amt,fee,rcv):  # _validateFee L511-530
        lo=amt*pi['minBps']//MAXBPS; hi=amt*pi['maxBps']//MAXBPS
        if not lo<=fee<=hi: raise Rev(f"FeeAmountOutOfRange fee={fee} range=[{lo},{hi}]")
        if pi['feeRcv'] and pi['feeRcv']!=rcv: raise Rev("InvalidFeeReceiver")
    def authorize(s,pi,amt,t):
        assert t<pi['preExp']; s.mv(pi['payer'],'store',amt); s.st[pi['id']]=dict(cap=amt,refd=0)
    def capture(s,pi,amt,fee,rcv,t):
        s.fee(pi,amt,fee,rcv)
        if t>=pi['authExp']: raise Rev("AfterAuthorizationExpiry")
        x=s.st[pi['id']]
        if x['cap']<amt: raise Rev("InsufficientAuthorization")
        x['cap']-=amt; x['refd']+=amt
        if fee: s.mv('store',rcv,fee)
        if amt>fee: s.mv('store',pi['receiver'],amt-fee)
    def void(s,pi):
        x=s.st[pi['id']]; a=x['cap']; assert a; x['cap']=0; s.mv('store',pi['payer'],a)
    def reclaim(s,pi,t):
        if t<pi['authExp']: raise Rev("BeforeAuthorizationExpiry")
        x=s.st[pi['id']]; a=x['cap']
        if a==0: raise Rev("ZeroAuthorization")
        x['cap']=0; s.mv('store',pi['payer'],a)
def mk(minb,maxb,feercv=None): return dict(id='c1',payer='buyer',receiver='seller',minBps=minb,maxBps=maxb,feeRcv=feercv,preExp=10,authExp=100,refExp=100)
P,F=1000,50
print("== F4a: refund path must still pay adjudicator fee (architecture.md Refund row)")
for maxb in (500,10000):
    c=CPP(); c.bal={'buyer':P+F}; pi=mk(0,maxb); c.authorize(pi,P+F,1)
    try:
        c.capture(pi,F,F,'adj',50)   # fee-only capture
        c.void(pi); print(f" maxFeeBps={maxb}: ok balances",{k:v for k,v in c.bal.items() if v})
    except Rev as e: print(f" maxFeeBps={maxb}: REVERT {e}")
print("== F4b: accept path single capture")
c=CPP(); c.bal={'buyer':P+F}; pi=mk(400,500); c.authorize(pi,P+F,1); c.capture(pi,P+F,F,'adj',50); print(" ",{k:v for k,v in c.bal.items() if v})
print("== F2: seller-paying capture vs payer reclaim (settle_after_window)")
for settle_t in (99,100):
    c=CPP(); c.bal={'buyer':P+F}; pi=mk(400,500); c.authorize(pi,P+F,1)
    c.reclaim  # buyer reclaim at t=100 beats a capture attempted at t>=100
    try: c.capture(pi,P+F,F,'adj',settle_t); print(f" capture@{settle_t}: ok")
    except Rev as e: print(f" capture@{settle_t}: {e}; buyer reclaim@100 ->",end=' ')
    try: c.reclaim(pi,100); print("buyer got",c.bal['buyer'])
    except Rev as e: print(e)
print("== F1: guaranteed mode, bond coverage 20% x open exposure vs overturn pays full price")
def run(n,cover=0.20,overturns=1):
    exposure=n*P; bond=int(cover*exposure); paid=0; short=0
    for _ in range(overturns):
        pay=min(P,bond); short+=P-pay; bond-=pay
    return exposure,int(cover*exposure),short,bond
for n,k in ((1,1),(5,1),(5,2),(10,3)):
    e,b,sh,left=run(n,overturns=k); print(f" open={n} overturns={k}: bond={b} wronged-party shortfall={sh} bond left={left}  (naive posting would give bond {b-k*P})")
print("== F5/F6: state machine graph from architecture.md")
doc=open('docs/architecture.md').read()
blk=doc.split('stateDiagram-v2')[1].split('```')[0]
E=[(a,b,l) for a,b,l in re.findall(r'^\s*(\w+|\[\*\]) --> (\w+)(?:: (.*))?$',blk,re.M)]
out={}
for a,b,l in E: out.setdefault(a,[]).append((b,l))
print(" terminal (no outgoing):",sorted({b for _,b,_ in E}-set(out)))
# Escalated path: what outcome does Final carry?
print(" Escalated ->",out['Escalated']); print(" Appealed ->",out['Appealed'])
print(" Final has outgoing?", 'Final' in out, "; label:",[l for a,b,l in E if b=='Final'])
print(" Escalated reaches Final with NO prior decision outcome; edges Accepted/Rejected->Final absent:", not any(b=='Final' and a in('Accepted','Rejected') for a,b,_ in E))
print(" Rejected ->",out['Rejected'], "(Held needs funds still held; guaranteed mode refunds at decision)")
# simulate guaranteed reject then resubmit
c=CPP(); c.bal={'buyer':P+F}; pi=mk(0,10000); c.authorize(pi,P+F,1); c.capture(pi,F,F,'adj',20); c.void(pi)
print(" after guaranteed reject (fee capture + void): escrow cap =",c.st['c1']['cap'],"-> Rejected->Held resubmit has nothing to hold")
