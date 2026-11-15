# Literal transcription of the design's pacing rule, to test edge cases.
def pace(obs, now, policy, provider, estimate):
    known = {o["window"] for o in obs if o["provider"] == provider}  # "every known window"
    usable = {}
    for o in obs:
        if o["provider"] != provider: continue
        if now - o["observedAt"] <= policy["freshness"] and now < o["resetsAt"]:
            usable.setdefault(o["window"], []).append(o)
    if any(o["usedPercent"] + estimate > 100 - policy["reserve"][w] for w, os in usable.items() for o in os):
        return "Hold"
    if any(w not in usable for w in known):
        return "Unknown"
    return "Allow"
pol = dict(freshness=600, reserve={"5h": 30, "7d": 40})
print("no observations at all:", pace([], 0, pol, "claude", 15))
print("only 5h window ever reported, 7d absent:", pace([dict(provider="claude", window="5h", usedPercent=10, resetsAt=10_000, observedAt=0)], 60, pol, "claude", 15))
print("two readings same window, older one fresh+high:", pace([
  dict(provider="claude", window="5h", usedPercent=80, resetsAt=10_000, observedAt=0),
  dict(provider="claude", window="5h", usedPercent=5, resetsAt=10_000, observedAt=500)], 550, pol, "claude", 15))
