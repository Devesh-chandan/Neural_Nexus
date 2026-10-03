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
    const apiError: ApiError = {
      status: err.response?.status ?? 0,
      error_code: data?.error_code ?? 'NETWORK_ERROR',
      detail: data?.detail ?? err.message ?? 'Unknown error',
    };
    return Promise.reject(apiError);
  }
);

export default api;
