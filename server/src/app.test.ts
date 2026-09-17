import type { Response } from 'express';

import { describe, expect, it, vi } from 'vitest';

import { getHealth, HEALTH_RESPONSE } from './app.js';

describe('GET /health', () => {
  it('reports that the API is healthy', async () => {
    const response = {
      json: vi.fn(),
      status: vi.fn(),
    };
    response.status.mockReturnValue(response);

    getHealth({} as never, response as unknown as Response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(HEALTH_RESPONSE);
  });
});
