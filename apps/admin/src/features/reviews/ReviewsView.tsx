import { Select } from '@/components/Select';
import { LoadError, PagerBar, PillRow, SearchBox } from '@/components/ListBits';
import { PortalFrame } from '@/components/PortalFrame';
import { requireSession } from '@/lib/auth';
import { buildHref, lastPage, PAGE_SIZE, pageNumber, searchText } from '@/lib/format';
import { loadFilterOptions } from '../jobs/queries';
import { parseReviews } from './parse';
import { ReviewsTable } from './ReviewsTable';

type Params = { stars?: string; cat?: string; q?: string; page?: string };
const STARS = ['5', '4', '3', 'low', 'hidden'] as const;

/** Worker reviews (A15): what residents say about each worker. Staff can hide a review (kept, not counted). */
export async function ReviewsView({ params }: { params: Params }) {
  const { supabase, user } = await requireSession();
  const stars = (STARS as readonly string[]).includes(params.stars ?? '') ? (params.stars as string) : 'all';
  const cat = typeof params.cat === 'string' && /^[0-9]{1,4}$/.test(params.cat) ? Number(params.cat) : null;
  const q = searchText(params.q);
  const page = pageNumber(params.page);

  const [options, res] = await Promise.all([
    loadFilterOptions(supabase),
    supabase.rpc('admin_reviews_list', { p_stars: stars, p_category: cat ?? undefined, p_search: q || undefined, p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE }),
  ]);
  const list = parseReviews(res.error ? null : res.data);
  const base = (over: Record<string, string | number | null>) => buildHref('/reviews', { stars: stars === 'all' ? null : stars, cat, q, ...over });
  const label: Record<string, string> = { all: 'All', '5': '5 stars', '4': '4 stars', '3': '3 stars', low: '2 stars or less', hidden: `Hidden ${list.hidden}` };

  return (
    <PortalFrame
      supabase={supabase}
      user={user}
      active="/reviews"
      title="Worker reviews"
      sub="What residents say about each worker. Workers only see their own average rating."
      right={<SearchBox action="/reviews" q={q} placeholder="Search worker, resident or job" keep={{ stars: stars === 'all' ? null : stars, cat: cat ? String(cat) : null }} />}
    >
      <PillRow
        active={stars}
        pills={['all', ...STARS].map((k) => ({ key: k, label: label[k]!, href: base({ stars: k === 'all' ? null : k, page: null }) }))}
        right={
          <form action="/reviews" method="get" className="row g8">
            {stars !== 'all' ? <input type="hidden" name="stars" value={stars} /> : null}
            {q ? <input type="hidden" name="q" value={q} /> : null}
            <Select compact width={190} name="cat" ariaLabel="Category" placeholder="All categories" allLabel="All categories" defaultValue={String(cat ?? '')} options={options.categories.map((c) => ({ value: String(c.id), label: c.name }))} />
            <button className="btn soft sm" type="submit">Apply</button>
          </form>
        }
      />
      {res.error ? <LoadError /> : null}
      <ReviewsTable rows={list.rows} empty={q || stars !== 'all' || cat ? 'No review matches.' : 'No reviews yet.'} />
      <PagerBar shown={list.rows.length} total={list.total} page={page} last={lastPage(list.total)} noun="reviews" hrefFor={(p) => base({ page: p })} />
    </PortalFrame>
  );
}
