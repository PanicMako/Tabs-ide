import { defineMiddleware } from "astro:middleware";

// Static deployment has the same rewrite in its Vercel Build Output routes.
export const onRequest = defineMiddleware((context, next) => {
  const namespace = context.url.searchParams.get("namespace") ?? "";
  const name = context.url.searchParams.get("name") ?? "";
  if (
    context.url.pathname === "/extension" &&
    /^[a-z][a-z0-9-]{1,62}$/.test(namespace) &&
    /^[a-z][a-z0-9-]{1,62}$/.test(name)
  )
    return context.redirect(`/extensions/${namespace}/${name}`, 308);
  if (/^\/extensions\/[a-z][a-z0-9-]{1,62}\/[a-z][a-z0-9-]{1,62}\/?$/.test(context.url.pathname))
    return context.rewrite("/extension");
  return next();
});
