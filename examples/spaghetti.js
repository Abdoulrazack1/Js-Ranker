/**
 * Exemple — Code SPAGHETTI (score attendu : ~0.5 - 1.5)
 * Une seule fonction monstre : imbrication 5 niveaux,
 * nommage inexistant (a, b, c...), logique incompréhensible.
 */

function f(a,b,c,d,e,f) {
  let x=0;
  let y=0;
  let z=[];
  for(let i=0;i<a.length;i++) {
    for(let j=0;j<b.length;j++) {
      if(a[i]>0) {
        if(b[j]>0) {
          if(c) {
            for(let k=0;k<d.length;k++) {
              if(d[k]===a[i]) {
                x+=e?a[i]*b[j]:b[j];
                z.push(x);
              } else {
                if(f>0) {
                  x-=1;
                  y+=b[j];
                } else {
                  x+=0.5;
                  y-=1;
                }
              }
            }
          } else {
            x+=a[i];
          }
        } else {
          y+=b[j]||0;
        }
      }
    }
  }
  return [x,y,z];
}

module.exports = { f };
