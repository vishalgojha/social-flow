process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/socialclaw';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-123';

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { buildApp } from '../src/app';

describe('api integration', () => {
  const app = buildApp();
  const token = jwt.sign({ sub: 'user_1', tenantId: 'tenant_1', role: 'owner' }, process.env.JWT_SECRET as string);

  afterAll(async () => {
    await app.close();
  });

  it('serves health', async () => {
    const res = await request(app.server).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('rejects missing auth for protected route', async () => {
    const res = await request(app.server).post('/v1/tenants').send({ name: 'A', slug: 'a' });
    expect(res.status).toBe(401);
  });

  it('accepts authenticated request shape', async () => {
    const res = await request(app.server)
      .post('/v1/workflows/draft')
      .set('Authorization', `Bearer ${token}`)
      .send({ clientId: 'client_1', intent: 'Reactivate leads with follow-up' });
    expect([200, 500]).toContain(res.status);
  });
});
