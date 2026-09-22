import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InitialPrincipalReturn } from './InitialPrincipalReturn';

test('라운드 종료 후 보유수량과 종가가 없어도 최초 원금 대비 손익을 표시한다', () => {
  const html = renderToStaticMarkup(createElement(InitialPrincipalReturn, {principal: 140000, cash: 134966.4, quantity: 0}));
  assert.match(html, /140,000.00/);
  assert.match(html, /-\$5,033.60/);
  assert.match(html, /-3.6%/);
});

test('다음 라운드 보유주식은 현재 평가액에 포함하고 종가가 없으면 손익을 확정하지 않는다', () => {
  const props = {principal: 10000, cash: 9000, quantity: 20};
  const html = renderToStaticMarkup(createElement(InitialPrincipalReturn, {...props, price: 100}));
  assert.match(html, /\+\$1,000.00/);
  assert.match(html, /\+10%/);
  const unknown = renderToStaticMarkup(createElement(InitialPrincipalReturn, props));
  assert.match(unknown, /—/);
  assert.doesNotMatch(unknown, /-\$1,000.00/);
});
