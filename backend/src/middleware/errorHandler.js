export const notFound = (req, _res, next) => {
  const err = new Error(`Route introuvable : ${req.method} ${req.originalUrl}`);
  err.status = 404;
  next(err);
};

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, _req, res, _next) => {
  const status = err.status || 500;
  res.status(status).json({
    error: err.message,
    ...(err.details && { details: err.details }),
  });
};