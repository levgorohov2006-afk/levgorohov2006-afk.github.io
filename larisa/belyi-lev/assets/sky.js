/* Звёздное небо «Белого Льва»: мерцающие звёзды, звёздный дождь и созвездие Льва.
   Координаты звёзд созвездия: прямое восхождение (часы) и склонение (градусы). */
(function(){
"use strict";
var LEO={
  stars:[
    {id:"a",name:"Регул",ra:10.139,dec:11.967,mag:1.35},
    {id:"h",ra:10.122,dec:16.763,mag:3.5},
    {id:"g",name:"Альгиеба",ra:10.333,dec:19.842,mag:2.0},
    {id:"z",ra:10.278,dec:23.417,mag:3.4},
    {id:"m",ra:9.879,dec:26.007,mag:3.9},
    {id:"e",ra:9.764,dec:23.774,mag:3.0},
    {id:"d",name:"Зосма",ra:11.235,dec:20.524,mag:2.6},
    {id:"t",ra:11.237,dec:15.430,mag:3.3},
    {id:"b",name:"Денебола",ra:11.818,dec:14.572,mag:2.1}
  ],
  lines:[["a","h"],["h","g"],["g","z"],["z","m"],["m","e"],["g","d"],["d","b"],["b","t"],["t","a"],["t","h"]]
};
// проекция на плоскость: восток слева, как на небе; лев смотрит вправо
(function(){
  var ra0=10.79*15, dec0=19, k=Math.cos(dec0*Math.PI/180), minX=1e9,maxX=-1e9,minY=1e9,maxY=-1e9;
  LEO.stars.forEach(function(s){s.px=-(s.ra*15-ra0)*k;s.py=-(s.dec-dec0);minX=Math.min(minX,s.px);maxX=Math.max(maxX,s.px);minY=Math.min(minY,s.py);maxY=Math.max(maxY,s.py)});
  var w=maxX-minX;
  LEO.stars.forEach(function(s){s.u=(s.px-minX)/w;s.v=(s.py-minY)/w});
  LEO.aspect=(maxY-minY)/w;
  LEO.byId={};LEO.stars.forEach(function(s){LEO.byId[s.id]=s});
})();

function glowSprite(rgb){
  var c=document.createElement("canvas");c.width=c.height=64;var x=c.getContext("2d");
  var g=x.createRadialGradient(32,32,0,32,32,32);
  g.addColorStop(0,"rgba(255,255,255,1)");g.addColorStop(.12,"rgba("+rgb+",.95)");g.addColorStop(.35,"rgba("+rgb+",.28)");g.addColorStop(1,"rgba("+rgb+",0)");
  x.fillStyle=g;x.fillRect(0,0,64,64);return c;
}

function Sky(canvas,opt){
  opt=opt||{};
  var ctx=canvas.getContext("2d"), dpr=1, W=0, H=0, stars=[], meteors=[], neb=null;
  var reduce=matchMedia("(prefers-reduced-motion: reduce)").matches;
  var leoBox=opt.leo||{x:.7,y:.24,w:.42}, base=opt.rate==null?.9:opt.rate, boost=0, ox=0, oy=0, born=performance.now(), last=born, acc=0, running=true;
  var sprW=glowSprite("214,226,255"), sprG=glowSprite("255,226,170");
  function size(){
    dpr=Math.min(innerWidth<700?1.5:2,devicePixelRatio||1);
    W=canvas.clientWidth||innerWidth;H=canvas.clientHeight||innerHeight;
    canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);
    var n=Math.min(900,Math.round(W*H/1700));stars=[];
    for(var i=0;i<n;i++){var r=Math.random();
      stars.push({x:Math.random(),y:Math.random(),r:r<.82?.35+Math.random()*.5:(r<.97?.9+Math.random()*.5:1.5+Math.random()*.6),
        a:.25+Math.random()*.65,tw:.4+Math.random()*2.2,ph:Math.random()*6.3,z:.25+Math.random()*.75,
        c:Math.random()<.14?"255,232,200":(Math.random()<.3?"200,215,255":"255,255,255")});}
    neb=document.createElement("canvas");neb.width=Math.max(1,Math.round(W/2));neb.height=Math.max(1,Math.round(H/2));
    var nx=neb.getContext("2d"),blobs=[[.18,.22,.55,"72,58,160"],[.82,.7,.6,"30,70,150"],[.6,.15,.4,"110,60,140"],[.3,.85,.5,"20,40,110"]];
    blobs.forEach(function(b){var g=nx.createRadialGradient(b[0]*neb.width,b[1]*neb.height,0,b[0]*neb.width,b[1]*neb.height,b[2]*Math.max(neb.width,neb.height));
      g.addColorStop(0,"rgba("+b[3]+",.22)");g.addColorStop(1,"rgba("+b[3]+",0)");nx.fillStyle=g;nx.fillRect(0,0,neb.width,neb.height)});
  }
  function spawn(fast){
    var ang=(108+Math.random()*16)*Math.PI/180, sp=(620+Math.random()*700)*(fast?1.25:1);
    meteors.push({x:Math.random()*W*1.25,y:-40-Math.random()*H*.35,vx:Math.cos(ang)*sp,vy:Math.sin(ang)*sp,
      len:70+Math.random()*190,life:0,max:.7+Math.random()*.9,w:.7+Math.random()*1.3,gold:Math.random()<.18});
  }
  function leoGeom(){
    var lw=leoBox.w*W; if(opt.leoMin)lw=Math.max(lw,opt.leoMin); if(opt.leoMax)lw=Math.min(lw,opt.leoMax);
    return {x:leoBox.x*W-lw/2+ox*.18,y:leoBox.y*H-lw*LEO.aspect/2+oy*.18,w:lw};
  }
  function draw(now){
    var t=(now-born)/1000, dt=Math.min(.05,(now-last)/1000);last=now;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.fillStyle=opt.bg||"#02030b";ctx.fillRect(0,0,W,H);
    if(neb)ctx.drawImage(neb,0,0,W,H);
    // звёзды
    for(var i=0;i<stars.length;i++){var s=stars[i];
      var x=((s.x*W+ox*s.z)%W+W)%W, y=((s.y*H+oy*s.z)%H+H)%H;
      var a=reduce?s.a:s.a*(.62+.38*Math.sin(t*s.tw+s.ph));
      ctx.fillStyle="rgba("+s.c+","+a.toFixed(3)+")";
      if(s.r<1)ctx.fillRect(x,y,s.r*1.6,s.r*1.6);
      else{ctx.beginPath();ctx.arc(x,y,s.r,0,6.283);ctx.fill();
        if(s.r>1.6){ctx.globalAlpha=a*.5;ctx.drawImage(sprW,x-s.r*5,y-s.r*5,s.r*10,s.r*10);ctx.globalAlpha=1}}
    }
    // созвездие Льва
    if(opt.leo!==false){
      var G=leoGeom(), k=reduce?1:Math.min(1,Math.max(0,(t-.4)/2.4)), ls=LEO.lines;
      ctx.lineWidth=1;ctx.strokeStyle="rgba(222,230,255,"+(opt.lineAlpha||.3)+")";ctx.beginPath();
      for(var l=0;l<ls.length;l++){
        var p=Math.min(1,Math.max(0,k*ls.length-l)); if(p<=0)break;
        var A=LEO.byId[ls[l][0]],B=LEO.byId[ls[l][1]];
        var x1=G.x+A.u*G.w,y1=G.y+A.v*G.w,x2=G.x+B.u*G.w,y2=G.y+B.v*G.w;
        ctx.moveTo(x1,y1);ctx.lineTo(x1+(x2-x1)*p,y1+(y2-y1)*p);
      }
      ctx.stroke();
      var sc=Math.max(.75,Math.min(1.35,G.w/420));
      for(var j=0;j<LEO.stars.length;j++){var S=LEO.stars[j];
        var sx=G.x+S.u*G.w, sy=G.y+S.v*G.w, rr=(1+(4.3-S.mag)*1.05)*sc, pul=reduce?1:(.85+.15*Math.sin(t*1.3+j));
        var app=reduce?1:Math.min(1,Math.max(0,(t-.15-j*.12)/.6));
        ctx.globalAlpha=app*pul;ctx.drawImage(S.id==="a"?sprG:sprW,sx-rr*6,sy-rr*6,rr*12,rr*12);
        ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(sx,sy,rr*.55,0,6.283);ctx.fill();
        if(S.name&&opt.labels!==false&&G.w>260){ctx.globalAlpha=app*.42;ctx.font="300 "+Math.round(10*sc)+"px Inter, Manrope, sans-serif";ctx.fillStyle="#dfe6ff";
          ctx.fillText(S.name,sx+rr*2.2,sy+rr*2.6)}
        ctx.globalAlpha=1;
      }
      if(opt.caption&&G.w>260){ctx.globalAlpha=.35*k;ctx.font="300 "+Math.round(10*sc)+"px Inter, Manrope, sans-serif";ctx.fillStyle="#dfe6ff";
        ctx.fillText(opt.caption,G.x+LEO.byId.b.u*G.w-4*sc,G.y+LEO.byId.b.v*G.w+34*sc);ctx.globalAlpha=1}
    }
    // звёздный дождь
    if(!reduce){
      boost*=Math.pow(.25,dt);
      acc+=dt*(base+boost*7);
      while(acc>1){acc-=1;spawn(boost>.6)}
      if(meteors.length>70)meteors.splice(0,meteors.length-70);
      for(var m=meteors.length-1;m>=0;m--){var M=meteors[m];
        M.life+=dt;M.x+=M.vx*dt;M.y+=M.vy*dt;
        var f=Math.min(1,M.life/.12)*(1-Math.max(0,(M.life-M.max*.6)/(M.max*.4)));
        if(M.life>M.max||M.y>H+60||M.x<-260){meteors.splice(m,1);continue}
        var sp=Math.hypot(M.vx,M.vy), tx=M.x-M.vx/sp*M.len, ty=M.y-M.vy/sp*M.len;
        var g=ctx.createLinearGradient(M.x,M.y,tx,ty), col=M.gold?"255,224,170":"220,232,255";
        g.addColorStop(0,"rgba(255,255,255,"+(.95*f).toFixed(3)+")");g.addColorStop(.25,"rgba("+col+","+(.45*f).toFixed(3)+")");g.addColorStop(1,"rgba("+col+",0)");
        ctx.strokeStyle=g;ctx.lineWidth=M.w;ctx.lineCap="round";ctx.beginPath();ctx.moveTo(M.x,M.y);ctx.lineTo(tx,ty);ctx.stroke();
        ctx.globalAlpha=f*.8;ctx.drawImage(M.gold?sprG:sprW,M.x-7*M.w,M.y-7*M.w,14*M.w,14*M.w);ctx.globalAlpha=1;
      }
    }
  }
  function loop(now){if(!running)return;draw(now);requestAnimationFrame(loop)}
  size();
  addEventListener("resize",function(){var w=canvas.clientWidth||innerWidth,h=canvas.clientHeight||innerHeight;if(Math.abs(w-W)>40||Math.abs(h-H)>120)size()});
  document.addEventListener("visibilitychange",function(){if(document.hidden){running=false}else if(!running){running=true;last=performance.now();requestAnimationFrame(loop)}});
  if(reduce)draw(performance.now()+4000);
  requestAnimationFrame(loop);
  return {
    boost:function(v){boost=Math.min(4,boost+v)},
    burst:function(n){for(var i=0;i<(n||12);i++)spawn(true)},
    offset:function(x,y){ox=x;oy=y},
    leo:function(b){leoBox=b}
  };
}
window.Sky=Sky;window.LEO=LEO;
})();
