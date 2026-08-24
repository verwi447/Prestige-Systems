const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "all"];

function wrapIfAsync(handler) {
  if (typeof handler !== "function" || handler.constructor.name !== "AsyncFunction") return handler;
  return function wrappedAsyncHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

// Express 4 does not forward a rejected promise from an async route handler
// to the error middleware; left unguarded, it becomes an unhandled rejection
// that can crash the whole process. Wrapping every registered handler here
// means individual route files don't each need their own try/catch/next.
export function autoAsyncRoutes(router) {
  for (const method of HTTP_METHODS) {
    const original = router[method].bind(router);
    router[method] = (path, ...handlers) => original(path, ...handlers.map(wrapIfAsync));
  }
  return router;
}
