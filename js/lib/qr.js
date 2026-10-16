/* QR code encoder (byte mode, error-correction level L, versions 1-40) for the nearby-sync codes.
   Follows ISO/IEC 18004; structure after Project Nayuki's reference implementation. Verified against jsQR for every version range. */
var QR_ECC_L=[-1,7,10,15,20,26,18,20,24,30,18,20,24,26,30,22,24,28,30,28,28,28,28,30,30,26,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30];
var QR_BLK_L=[-1,1,1,1,1,1,2,2,2,2,4,4,4,4,4,6,6,6,6,7,8,8,9,9,10,12,12,12,13,14,15,16,17,18,19,19,20,21,22,24,25];
function qrRawModules(ver){ var r=(16*ver+128)*ver+64; if(ver>=2){ var na=Math.floor(ver/7)+2; r-=(25*na-10)*na-55; if(ver>=7) r-=36; } return r; }
function qrDataCodewords(ver){ return Math.floor(qrRawModules(ver)/8)-QR_ECC_L[ver]*QR_BLK_L[ver]; }
function qrMul(x,y){ var z=0; for(var i=7;i>=0;i--){ z=(z<<1)^((z>>>7)*0x11D); z^=((y>>>i)&1)*x; } return z&0xFF; }
function qrDivisor(deg){ var r=[], i, j; for(i=0;i<deg-1;i++) r.push(0); r.push(1); var root=1;
  for(i=0;i<deg;i++){ for(j=0;j<r.length;j++){ r[j]=qrMul(r[j],root); if(j+1<r.length) r[j]^=r[j+1]; } root=qrMul(root,0x02); } return r; }
function qrRemainder(data,div){ var r=[], i, j; for(i=0;i<div.length;i++) r.push(0);
  for(i=0;i<data.length;i++){ var f=data[i]^r.shift(); r.push(0); for(j=0;j<div.length;j++) r[j]^=qrMul(div[j],f); } return r; }
function utf8Bytes(s){ var out=[], u=unescape(encodeURIComponent(s)); for(var i=0;i<u.length;i++) out.push(u.charCodeAt(i)); return out; }
export function qrEncode(text){
  var data=utf8Bytes(text), ver, cap=0;
  for(ver=1;ver<=40;ver++){ cap=qrDataCodewords(ver)*8; var need=4+(ver<10?8:16)+data.length*8; if(need<=cap) break; }
  if(ver>40) throw new Error("too long");
  var bits=[], i, j;
  function put(v,n){ for(var k=n-1;k>=0;k--) bits.push((v>>>k)&1); }
  put(4,4); put(data.length,ver<10?8:16); for(i=0;i<data.length;i++) put(data[i],8);
  put(0,Math.min(4,cap-bits.length)); while(bits.length%8) bits.push(0);
  var cw=[]; for(i=0;i<bits.length;i+=8){ var b=0; for(j=0;j<8;j++) b=(b<<1)|bits[i+j]; cw.push(b); }
  for(var pb=0xEC; cw.length<cap/8; pb^=0xEC^0x11) cw.push(pb);
  /* error correction + interleave */
  var nb=QR_BLK_L[ver], eccLen=QR_ECC_L[ver], raw=Math.floor(qrRawModules(ver)/8), nShort=nb-raw%nb, shortLen=Math.floor(raw/nb);
  var div=qrDivisor(eccLen), blocks=[], k=0;
  for(i=0;i<nb;i++){ var dat=cw.slice(k,k+shortLen-eccLen+(i<nShort?0:1)); k+=dat.length; var ecc=qrRemainder(dat,div); if(i<nShort) dat.push(0); blocks.push(dat.concat(ecc)); }
  var all=[]; for(i=0;i<blocks[0].length;i++){ for(j=0;j<blocks.length;j++){ if(i!==shortLen-eccLen || j>=nShort) all.push(blocks[j][i]); } }
  /* matrix */
  var size=ver*4+17, mod=[], fn=[];
  for(i=0;i<size;i++){ mod.push([]); fn.push([]); for(j=0;j<size;j++){ mod[i].push(false); fn[i].push(false); } }
  function setF(x,y,dark){ mod[y][x]=dark; fn[y][x]=true; }
  for(i=0;i<size;i++){ setF(6,i,i%2===0); setF(i,6,i%2===0); }
  function finder(x,y){ for(var dy=-4;dy<=4;dy++) for(var dx=-4;dx<=4;dx++){ var d=Math.max(Math.abs(dx),Math.abs(dy)), xx=x+dx, yy=y+dy; if(xx>=0&&xx<size&&yy>=0&&yy<size) setF(xx,yy,d!==2&&d!==4); } }
  finder(3,3); finder(size-4,3); finder(3,size-4);
  var al=[]; if(ver>1){ var na=Math.floor(ver/7)+2, step=(ver===32)?26:Math.ceil((ver*4+4)/(na*2-2))*2; al=[6]; for(var pos=size-7; al.length<na; pos-=step) al.splice(1,0,pos); }
  for(i=0;i<al.length;i++) for(j=0;j<al.length;j++){
    if((i===0&&j===0)||(i===0&&j===al.length-1)||(i===al.length-1&&j===0)) continue;
    for(var ay=-2;ay<=2;ay++) for(var ax=-2;ax<=2;ax++) setF(al[i]+ax,al[j]+ay,Math.max(Math.abs(ax),Math.abs(ay))!==1);
  }
  function formatBits(mask){
    var d=(1<<3)|mask, r=d; for(var q=0;q<10;q++) r=(r<<1)^((r>>>9)*0x537);
    var b=((d<<10)|r)^0x5412;
    function g(n){ return ((b>>>n)&1)!==0; }
    for(var q2=0;q2<=5;q2++) setF(8,q2,g(q2));
    setF(8,7,g(6)); setF(8,8,g(7)); setF(7,8,g(8));
    for(q2=9;q2<15;q2++) setF(14-q2,8,g(q2));
    for(q2=0;q2<8;q2++) setF(size-1-q2,8,g(q2));
    for(q2=8;q2<15;q2++) setF(8,size-15+q2,g(q2));
    setF(8,size-8,true);
  }
  formatBits(0);
  if(ver>=7){ var rv=ver; for(i=0;i<12;i++) rv=(rv<<1)^((rv>>>11)*0x1F25); var vb=(ver<<12)|rv;
    for(i=0;i<18;i++){ var bit=((vb>>>i)&1)!==0, a=size-11+i%3, bb=Math.floor(i/3); setF(a,bb,bit); setF(bb,a,bit); } }
  /* data placement (zigzag) */
  var bi=0;
  for(var right=size-1; right>=1; right-=2){ if(right===6) right=5;
    for(var vert=0; vert<size; vert++){ for(j=0;j<2;j++){ var x=right-j, up=((right+1)&2)===0, y=up?size-1-vert:vert;
      if(!fn[y][x] && bi<all.length*8){ mod[y][x]=((all[bi>>>3]>>>(7-(bi&7)))&1)!==0; bi++; } } } }
  function maskBit(m,x,y){ switch(m){ case 0: return (x+y)%2===0; case 1: return y%2===0; case 2: return x%3===0; case 3: return (x+y)%3===0;
    case 4: return (Math.floor(x/3)+Math.floor(y/2))%2===0; case 5: return x*y%2+x*y%3===0; case 6: return (x*y%2+x*y%3)%2===0; default: return ((x+y)%2+x*y%3)%2===0; } }
  function applyMask(m){ for(var yy=0;yy<size;yy++) for(var xx=0;xx<size;xx++) if(!fn[yy][xx] && maskBit(m,xx,yy)) mod[yy][xx]=!mod[yy][xx]; }
  function penalty(){ var p=0, yy, xx, run, dark=0;
    for(yy=0;yy<size;yy++){ run=1; for(xx=1;xx<size;xx++){ if(mod[yy][xx]===mod[yy][xx-1]){ run++; if(run===5) p+=3; else if(run>5) p++; } else run=1; } }
    for(xx=0;xx<size;xx++){ run=1; for(yy=1;yy<size;yy++){ if(mod[yy][xx]===mod[yy-1][xx]){ run++; if(run===5) p+=3; else if(run>5) p++; } else run=1; } }
    for(yy=0;yy<size-1;yy++) for(xx=0;xx<size-1;xx++){ var c=mod[yy][xx]; if(c===mod[yy][xx+1]&&c===mod[yy+1][xx]&&c===mod[yy+1][xx+1]) p+=3; }
    for(yy=0;yy<size;yy++) for(xx=0;xx<size;xx++) if(mod[yy][xx]) dark++;
    p+=Math.floor(Math.abs(dark*20-size*size*10)/(size*size))*10; return p; }
  var best=0, bestP=1e9;
  for(var m=0;m<8;m++){ applyMask(m); formatBits(m); var pp=penalty(); if(pp<bestP){ bestP=pp; best=m; } applyMask(m); }
  applyMask(best); formatBits(best);
  return { size:size, mod:mod };
}
export function drawQR(cv,text){
  var q=qrEncode(text), border=4, n=q.size+border*2, scale=Math.max(2,Math.floor(600/n));
  cv.width=n*scale; cv.height=n*scale; var ctx=cv.getContext("2d");
  ctx.fillStyle="#fff"; ctx.fillRect(0,0,cv.width,cv.height); ctx.fillStyle="#000";
  for(var y=0;y<q.size;y++) for(var x=0;x<q.size;x++) if(q.mod[y][x]) ctx.fillRect((x+border)*scale,(y+border)*scale,scale,scale);
}
