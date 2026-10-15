# Malformed image header fallback gap

ReviewedHEAD bb89383e8516d6ee6c730579be3e353a8e43a0e9. FullnewimageDimensions154/test140 read. Existing8/8,119ms exit0 syntheticheaders coversPNG/GIF/JPEGAPP/EXIFrotation/standalonemarkers/Huffmanexclusion/WebPvariants/shortzero unsupported. Actualassetconsumersearch confirmsserver reads bounded256KiBheaders and invokeshelper forattachments/openfiles/inlineimagebytes.

Independent ImageMalformedHeaderAudit.test.ts2failed2,122ms terminal1: GIF8xx invalidversion and PNGsignaturewithinvalidfinalfourbytes both return20x10insteadnull. SourceonlychecksfirstfourPNG/GIFbytes andPNG IHDRmarker. This contradicts documented malformedfile-nullfallback. Concern is unreliablelayoutmetadata, without demonstratedbrowserlayoutfailure orsecurityimpact. Fullimagevalidation is not required to address signature/version checks. Restorefixture to packages/shared/src. Realcodec decode/AVIF/largeEXIF/runtimeassetintegration remainunverified; no productionchanges.
