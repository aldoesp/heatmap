export const notFound = (req, _res, next) => {
  const err = new Error(`Route introuvable : ${req.method} ${req.originalUrl}`);
  err.status = 404;
  next(err);
};

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, _req, res, _next) => {
  const status =
    err.status ||
    err.statusCode ||
    (err.code === 'LIMIT_FILE_SIZE' ? 413 : err.code?.startsWith('LIMIT_') ? 400 : 500);
  res.status(status).json({
    error: err.message,
    ...(err.details && { details: err.details }),
  });
};