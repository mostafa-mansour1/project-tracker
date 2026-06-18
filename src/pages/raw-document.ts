import type { APIRoute } from 'astro';
import { getDocuments, getProject } from '../lib/content';

export const prerender = false;

export const GET: APIRoute = ({ url }) => {
  const project = getProject(url.searchParams.get('project'));
  const documentSlug = url.searchParams.get('doc');
  const document = getDocuments(project).find((entry) => entry.slug === documentSlug && entry.type === 'html');

  if (!document) return new Response('HTML document not found.', { status: 404 });

  return new Response(document.source, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'self' data: blob: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self' https:;",
    },
  });
};
