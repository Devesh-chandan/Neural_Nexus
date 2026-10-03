import axios from 'axios';
import type { ApiError } from '../types';

const api = axios.create({
  baseURL: '/api',
  timeout: 60_000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const data = err.response?.data;
    // Backend AppError responses are shaped { error: { code, message } };
    // FastAPI's own errors use { detail }.
    const detail =
      data?.error?.message ??
      (typeof data?.detail === 'string' ? data.detail : undefined);
    const apiError: ApiError = {
      status: err.response?.status ?? 0,
      error_code: data?.error?.code ?? data?.error_code ?? 'NETWORK_ERROR',
      detail: detail ?? err.message ?? 'Unknown error',
    };
    return Promise.reject(apiError);
  }
);

export default api;
