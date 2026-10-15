# Companion CSV parser misses shared fix

HEAD bb89383e8516d6ee6c730579be3e353a8e43a0e9. Shared delimitedPreview56/test66 fully read, new againstbase; fresh9/9,353ms terminal0 covers BOM/quotes/multiline/emptyfinalrecord/100rows30columns2000charsbounds. No productionsharedparsercallerfound. Fullcompanion localfilePreview.ts read and CompanionFilesPanel365–390 confirms localparser supplies renderedtable.

Independent DelimitedCompanionAudit.test.ts imports both actualfunctions. Valid CSV name\nAlice\n"" yields three rows in sharedparser but onlytwo incompanion; fresh1failed1,127ms terminal1. The localparser final condition value||row.length drops a quotedemptyrecord. This is a confirmed viewer-data omission from source/caller/functionexecution; no browser screenshot yet. Sharedfix doesnotreach currentviewer. Localparser also lacks sharedcolumn/cell bounds/BOM/CR-only handling; not separatelyruntimeverified here. No productionchanges. Restorefixture to packages/shared/src for relativeimports.

Originalcompaniontest source read afterinitialwrongpackage-relative catpath; its suite notrun inthisbatch. Baseline lineage oflocalparser remains tocheck before labeling newlyintroduced regression.

Baselinecheck: originalbasecompanionfile absent; HEADnumstat41add0del confirmsnewimplementation. Thus finalquotedemptyrow omission is in newlyaddedcompanionparser, not an inheritedsamefile regression. Browserrender stillunverified.
