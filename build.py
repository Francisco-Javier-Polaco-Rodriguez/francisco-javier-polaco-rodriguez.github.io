"""Render the static site: index.html (en), fr/index.html, es/index.html.

Usage: python build.py
"""
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'src'))
import content as C  # noqa: E402

LANGS = ['en', 'fr', 'es']
OUT = {'en': ROOT / 'index.html', 'fr': ROOT / 'fr' / 'index.html', 'es': ROOT / 'es' / 'index.html'}
SITE_URL = 'https://francisco-javier-polaco-rodriguez.github.io/'  # GitHub Pages user site
PATH = {'en': '', 'fr': 'fr/', 'es': 'es/'}


def strip_tags(s):
    return html.unescape(re.sub(r'<[^>]+>', '', s))


def esc(s):
    return html.escape(s, quote=True)


# ---------------------------------------------------------------- publications
def bib_author(a):
    if a == C.ME:
        return r"{Polanco-Rodr{\'\i}guez}, F. J."
    if a.startswith('et al'):
        return 'others'
    last, first = a.split(', ', 1)
    return '{%s}, %s' % (last, first)


def bibtex(p):
    if p['status'] != 'published':
        return ''
    title = p.get('bibtitle', strip_tags(p['title']))
    f = [('author', ' and '.join(bib_author(a) for a in p['authors'])),
         ('title', '{%s}' % title), ('journal', p['jfull']), ('year', str(p['year'])),
         ('volume', p['volume']), ('pages', p['pages']), ('doi', p['doi'])]
    if p.get('arxiv'):
        f += [('eprint', p['arxiv']), ('archivePrefix', 'arXiv')]
    body = ',\n'.join('  %s = {%s}' % kv for kv in f)
    return '@article{%s,\n%s\n}' % (p['key'], body)


def authors_html(authors):
    out = []
    for a in authors:
        out.append('<strong class="me">%s</strong>' % esc(a) if a == C.ME else esc(a))
    return ', '.join(out)


def pubs_html(t):
    items = []
    for p in C.PUBS:
        first = p['authors'][0] == C.ME
        venue = '<i>%s</i>' % esc(p['journal'])
        links = []
        if p['status'] == 'published':
            venue += ' %s, %s (%d)' % (p['volume'], p['pages'], p['year'])
            links.append('<a href="https://doi.org/%s" rel="noopener">%s</a>' % (p['doi'], t['doi']))
            if p.get('arxiv'):
                links.append('<a href="https://arxiv.org/abs/%s" rel="noopener">%s</a>' % (p['arxiv'], t['arxiv']))
            links.append('<button type="button" class="bib" data-bib="%s">%s</button>' % (esc(bibtex(p)), t['copy_bib']))
            status = ''
        else:
            label = {'submitted': t['status_submitted'], 'prep': t['status_prep'], 'review': t['status_review']}[p['status']]
            status = '<span class="status">%s</span>' % label
            venue += ' (%d)' % p['year']
        items.append(
            '<li data-status="%s" data-first="%s">'
            '<p class="p-title" lang="en">%s</p>'
            '<p class="p-auth">%s</p>'
            '<p class="p-venue">%s %s</p>'
            '%s</li>' % (
                p['status'], 'true' if first else 'false', p['title'], authors_html(p['authors']),
                venue, status, '<p class="p-links">%s</p>' % ''.join(links) if links else ''))
    return ''.join(items)


def selected_html():
    items = []
    for p in C.PUBS:
        if p['status'] != 'published':
            continue
        items.append(
            '<li><span class="yr">%d</span><span>'
            '<a class="s-title" lang="en" href="https://doi.org/%s" rel="noopener">%s</a>'
            '<span class="s-meta">%s · <i>%s</i> %s, %s</span></span></li>' % (
                p['year'], p['doi'], p['title'], authors_html(p['authors']),
                esc(p['journal']), p['volume'], p['pages']))
    return ''.join(items)


def recent_talks_html(n=4):
    return ''.join(
        '<li><span class="yr">%d</span><span><span class="t-title" lang="en">%s</span><span class="t-venue">%s</span></span></li>' % (
            y, esc(title), esc(venue)) for y, venue, title, me in [o for o in C.ORAL if o[3]][:n])


def ref_label(key):
    p = next(p for p in C.PUBS if p['key'] == key)
    short = {'Astrophys. J. Lett.': 'ApJL', 'Astron. Astrophys.': 'A&amp;A', 'Nat. Astron.': 'Nature Astronomy'}[p['journal']]
    return '<a href="https://doi.org/%s" rel="noopener">%s %d</a>' % (p['doi'], short, p['year'])


# ---------------------------------------------------------------- blocks
def profiles_html():
    L = C.LINKS
    items = [('ORCID', L['orcid']), ('Google Scholar', L['scholar']),
             ('ResearchGate', L['researchgate']), ('HAL', L['thesis'])]
    return '<ul class="profiles">%s</ul>' % ''.join(
        '<li><a href="%s" rel="noopener">%s</a></li>' % (esc(u), n) for n, u in items)


def rel_root(lang):
    return '' if lang == 'en' else '../'


def lang_href(src, dst):
    if src == dst:
        return './'
    if src == 'en':
        return '%s/' % dst
    return '../' if dst == 'en' else '../%s/' % dst


def langs_html(lang):
    out = []
    for l in LANGS:
        cur = ' aria-current="true"' if l == lang else ''
        out.append('<a href="%s" hreflang="%s" lang="%s" title="%s"%s>%s</a>' % (
            lang_href(lang, l), l, l, C.T[l]['lang_name'], cur, l.upper()))
    return ''.join(out)


def hreflang_html(lang):
    rows = ['<link rel="canonical" href="%s%s">' % (SITE_URL, PATH[lang]),
            '<meta property="og:url" content="%s%s">' % (SITE_URL, PATH[lang])]
    rows += ['<link rel="alternate" hreflang="%s" href="%s%s">' % (l, SITE_URL, PATH[l]) for l in LANGS]
    rows.append('<link rel="alternate" hreflang="x-default" href="%s">' % SITE_URL)
    return '\n'.join(rows)


def talks_html(t):
    oral = ''.join(
        '<li><span class="yr">%d</span><span><span class="t-title" lang="en">%s</span><span class="t-venue">%s%s</span></span></li>' % (
            y, esc(title), esc(venue), '' if me else '. <em>%s</em>' % t['speaker_note'])
        for y, venue, title, me in C.ORAL)
    post = ''.join(
        '<li><span class="yr">%d</span><span><span class="t-title" lang="en">%s</span><span class="t-venue">%s</span></span></li>' % (
            y, esc(title), esc(venue)) for y, venue, title in C.POSTERS)
    return '<h3>%s</h3><ol class="tl">%s</ol><h3>%s</h3><ol class="tl">%s</ol>' % (t['oral_h'], oral, t['posters_h'], post)


ASTRO = [('astro_andromeda.webp', 1672, 876), ('astro_pleiades.webp', 655, 1005), ('astro_orion.webp', 1354, 1600), ('astro_moon.webp', 1200, 1200),
         ('astro_sun.webp', 1200, 1200), ('astro_orion2.webp', 860, 924)]


def drawer_html(name, t, root):
    if name == 'chiclana':
        inner = ('<figure class="shot"><img src="%sassets/media/chiclana_barrosa.webp" width="2000" height="878" '
                 'loading="lazy" alt="%s"><figcaption>%s</figcaption></figure>') % (root, esc(t['chiclana_cap']), t['chiclana_cap'])
    elif name == 'astro':
        inner = '<ul class="gallery">%s</ul>' % ''.join(
            '<li%s><figure><button type="button" class="zoom" data-full="%sassets/media/%s" data-cap="%s">'
            '<img src="%sassets/media/%s" width="%d" height="%d" loading="lazy" alt="%s"></button>'
            '<figcaption>%s</figcaption></figure></li>' % (' class="wide"' if w > 1.5 * h else '', root, f, esc(c), root, f, w, h, esc(c), c)
            for (f, w, h), c in zip(ASTRO, t['astro_caps']))
    else:
        raise KeyError(name)
    return '<div class="drawer" id="drawer-%s"><div class="drawer-in">%s</div></div>' % (name, inner)


def about_html(t, root):
    out = []
    for para in t['about_text']:
        names = re.findall(r'\[\[(\w+)\|', para)
        para = re.sub(r'\[\[(\w+)\|(.+?)\]\]',
                      r'<button type="button" class="inl" aria-expanded="false" aria-controls="drawer-\1">\2</button>', para)
        out.append('<p>%s</p>' % para)
        out += [drawer_html(n, t, root) for n in names]
    return ''.join(out)


def wave_svg(kind):
    """Small travelling wave drawn in the colour of the wave species a result is about."""
    import math
    n = {'z': 3, 'radio': 5, 'langmuir': 9, 'beam': 2}[kind]
    period = 120 / n
    pts = ' '.join('%.1f,%.2f' % (x / 2, 10 - 6.5 * math.sin(2 * math.pi * (x / 2) / period)) for x in range(0, 2 * (240 + 1)))
    return ('<svg class="wv" viewBox="0 0 120 20" aria-hidden="true" style="--p: -%.2fpx"><polyline points="%s"/></svg>' % (period, pts))


def result_extra(kind, t):
    if kind != 'radio':
        return ''
    return ('<div class="ebar" data-in><div class="e-track"><span class="e-z"></span><span class="e-o"></span></div>'
            '<p class="e-lbl"><span><b>≈90%%</b> %s</span><span><b>≈10%%</b> %s</span></p></div>' % (t['bar_trapped'], t['bar_escapes']))


def render(lang):
    t = dict(C.T[lang])
    root = rel_root(lang)
    v = dict(t)
    v.update(
        lang=lang, root=root, home='./', og_image=SITE_URL + 'assets/media/og.jpg',
        hreflang=hreflang_html(lang), langs=langs_html(lang),
        profiles=profiles_html(),
        pub_count=str(len(C.PUBS)),
        email=C.LINKS['email'], thesis_url=C.LINKS['thesis'],
        fig_alt=esc(strip_tags(t['fig_caption'])),
        interests_html=''.join('<li><h3>%s</h3><p>%s</p></li>' % (a, b) for a, b in t['interests']),
        thesis_summary_html=''.join('<p>%s</p>' % p for p in t['thesis_summary']),
        results_html=''.join(
            '<article class="result" style="--c: var(--%s)">%s<h4>%s</h4><p>%s</p>%s<p class="refs">%s</p></article>' % (
                kind, wave_svg(kind), h, p, result_extra(kind, t), ' '.join(ref_label(k) for k in refs))
            for kind, h, p, refs in t['results']),
        jury_html=''.join('<div><dt>%s</dt><dd>%s <span>%s</span></dd></div>' % (
            t['jury_roles'].get(r + '_' + g, t['jury_roles'][r]), n, a) for r, g, n, a in C.JURY),
        honors_html=''.join('<div><dt>%s</dt><dd>%s</dd></div>' % r for r in t['honors']),
        teaching_html=''.join('<div><dt>%s</dt><dd><strong>%s</strong> %s</dd></div>' % r for r in t['teaching']),
        stats_html=''.join(
            '<li style="--c: var(--%s)" data-in><p class="num">%s<span data-count="%d">%d</span><span class="unit">%s</span></p>'
            '<p class="lbl">%s</p></li>' % (c, pre, n, n, suf, lbl) for pre, n, suf, lbl, c in t['stats']),
        compute_html=''.join('<li><b>%s</b><span>%s</span></li>' % c for c in t['compute']),
        talks_html=talks_html(t),
        recent_talks_html=recent_talks_html(),
        selected_html=selected_html(),
        about_html=about_html(t, root),
        obs1_ref=ref_label('Polanco2025a'), obs2_ref=ref_label('Polanco2026b'),
        path_html=''.join('<li><span class="yr">%s</span><span>%s</span></li>' % r for r in t['path']),
        pubs_html=pubs_html(t),
        js_strings=json.dumps(dict(copied=t['copied'], copy_bib=t['copy_bib'],
                                   anim_pause=t['anim_pause'], anim_play=t['anim_play'], earth=t['earth']), ensure_ascii=False),
        jsonld=json.dumps({
            '@context': 'https://schema.org', '@type': 'Person',
            'name': 'Francisco Javier Polanco-Rodríguez', 'jobTitle': strip_tags(t['hero_role']),
            'affiliation': 'Laboratoire de Physique des Plasmas, École Polytechnique',
            'email': 'mailto:' + C.LINKS['email'], 'url': SITE_URL,
            'sameAs': [C.LINKS['orcid'], C.LINKS['scholar'], C.LINKS['researchgate']],
        }, ensure_ascii=False),
    )
    v['hero_role'] = t['hero_role'].replace(' · ', '<br>')
    for k in ('meta_title', 'meta_desc', 'anim_label', 'anim_pause', 'spec_alt', 'dyn_text', 'stats_label', 'obs1_alt', 'obs_solo_alt', 'obs_sim_alt'):
        v[k] = esc(strip_tags(t[k]))

    tpl = (ROOT / 'src' / 'template.html').read_text(encoding='utf-8')

    def sub(m):
        key = m.group(1)
        if key not in v:
            raise KeyError('template key missing for %s: %s' % (lang, key))
        return str(v[key])

    return re.sub(r'\{\{(\w+)\}\}', sub, tpl)


def main():
    # every language must define the same keys as English
    ref = set(C.T['en'])
    for l in LANGS:
        missing = ref - set(C.T[l])
        if missing:
            raise SystemExit('%s missing keys: %s' % (l, sorted(missing)))
    for l in LANGS:
        OUT[l].parent.mkdir(parents=True, exist_ok=True)
        OUT[l].write_text(render(l), encoding='utf-8')
        print('wrote', OUT[l].relative_to(ROOT))


if __name__ == '__main__':
    main()
