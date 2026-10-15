# Environment HTTP contracts — batch207

HEAD unchanged bb89383e8516d6ee6c730579be3e353a8e43a0e9. Complete692line current source, full162-addition/29-deletion diff and62line new tests reviewed. Initial combined output truncation recovered240-570. Reused batch199 contracts824tests pass.

Changes remove legacy snapshot/dispatch HTTP endpoints, require orchestration protocol header on V2 shell/detail/bounded/history routes, add project and pull-request groups, add offline webhook holding preferences and four webhook methods with202 success. Auth middleware is declared for protected groups; webhook authentication intentionally belongs to token/signature handlers. Existing connect health/mint endpoints retain their payload credential flow.

The new test checks reason-bearing messages on six typed errors only. It provides no proof of HTTP response status encoding, protocol rejection, scope enforcement, route reachability, raw-body signature validation or preference persistence. Call inventory locates actual group builders in server auth/project/orchestration-v2/pullRequest/cloud/webhook modules and assembly in server.ts655-661. Earlier shipped main/serverLayers entrypoint disconnect remains unresolved; declarations are not runtime acceptance.

revokedCount still uses Schema.Number (unchanged), so absence of integer constraint is not attributed as a new Antigravity regression. No newly established production defect in this bounded contract review. No production edits; audit incomplete.
