// 爱壹帆源：App 链路与年份补齐
// 由原单文件测试 worker.test.js 机械拆分而来，用例名与断言未做改动。

import dotenv from 'dotenv';
dotenv.config();

import test from 'node:test';
import assert from 'node:assert';
import AiyifanSource from '../../sources/aiyifan.js';
import { AiyifanAppSigningProvider, AIYIFAN_WEB_YEAR_MAX_WAIT_MS, computeAiyifanWebSign } from '../../utils/aiyifan-util.js';
import { resetSearchState } from '../helpers/context.js';

test('aiyifan App chain keeps years and accepts legacy segment links', async t => {
  const makeSource = () => {
    const source = new AiyifanSource();
    source.searchDrama = async () => ({ data: { list: [{
      mediaKey: 'media', title: '年份测试', mediaType: '电视剧',
      postTime: '2020-01-01T00:00:00Z', coverImgUrl: 'https://example.com/cover.jpg'
    }] } });
    return source;
  };

  await t.test('a slow App search retains an already resolved year', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
    const source = makeSource();
    source.signingProvider.lookupYears = async () => new Map([['media', 2003]]);
    const searchDrama = source.searchDrama;
    source.searchDrama = async () => {
      await Promise.resolve();
      t.mock.timers.tick(AIYIFAN_WEB_YEAR_MAX_WAIT_MS + 1000);
      return searchDrama();
    };
    assert.equal((await source.search('年份测试'))[0].year, 2003);
  });

  await t.test('missing and timed-out years remain unknown through detail creation', async t => {
    resetSearchState();
    const source = makeSource();
    source.signingProvider.lookupYears = async () => new Map();
    const results = await source.search('年份测试');
    assert.equal(results[0].year, null);
    source.getEpisodes = async () => [{ title: '01', link: 'https://www.yfsp.tv/play/media?id=episode' }];
    const details = new Map();
    const [anime] = await source.handleAnimes(results, '年份测试', [], details);
    assert.ok(anime.animeTitle.includes('(N/A)'));
    assert.equal(anime.startDate, '');
    assert.equal([...details.values()][0].startDate, '');

    t.mock.timers.enable({ apis: ['setTimeout'] });
    source.signingProvider.lookupYears = () => new Promise(() => {});
    const pending = source.search('年份测试');
    t.mock.timers.tick(AIYIFAN_WEB_YEAR_MAX_WAIT_MS);
    assert.equal((await pending)[0].year, null);
  });

  await t.test('web keywords survive URL encoding without changing the signature input', () => {
    const provider = new AiyifanAppSigningProvider();
    const config = { publicKey: 'test-public', privateKey: 'test-private' };
    for (const keyword of ['Love & Death', 'Re:从零开始#第二季', 'A+B']) {
      const url = new URL('https://example.com/?' + provider.buildWebSignedQuery({ tags: keyword, page: 1 }, config));
      assert.equal(url.searchParams.get('tags'), keyword);
      assert.equal(url.searchParams.get('page'), '1');
      assert.equal(url.searchParams.get('vv'), computeAiyifanWebSign(`tags=${keyword}&page=1`, config));
      assert.equal(url.hash, '');
    }
  });

  await t.test('direct links and both legacy wrappers reach the same episode', async () => {
    const source = makeSource();
    const link = 'https://www.yfsp.tv/play/media?id=episode';
    const seen = [];
    source.getEpisodeDanmu = async id => { seen.push(id); return [{ second: 1, contxt: 'test' }]; };
    for (const url of [link,
      'https://m10.yfsp.tv/api/video/getBarrage?uniqueKey=' + link,
      'https://api.tripdata.app/api/Video/GetBarrages?link=' + encodeURIComponent(link)]) {
      assert.equal((await source.getEpisodeSegmentDanmu({ url })).length, 1);
    }
    assert.deepEqual(seen, [link, link, link]);
    assert.equal(source.resolveSegmentLink({ url: 'https://example.com/?site=yfsp.tv' }), null);
    assert.equal(source.resolveSegmentLink({ url: 'not a URL' }), null);
  });
});
