/*
Vector glyph outlines are derived from Liberation Sans Bold.
Copyright (c) 2010 Google Corporation and (c) 2012 Red Hat, Inc.
The glyph outlines are distributed under the SIL Open Font License 1.1.

SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
 .
 PREAMBLE The goals of the Open Font License (OFL) are to stimulate
 worldwide development of collaborative font projects, to support the font
 creation efforts of academic and linguistic communities, and to provide
 a free and open framework in which fonts may be shared and improved in
 partnership with others.
 .
 The OFL allows the licensed fonts to be used, studied, modified and
 redistributed freely as long as they are not sold by themselves.
 The fonts, including any derivative works, can be bundled, embedded,
 redistributed and/or sold with any software provided that any reserved
 names are not used by derivative works.  The fonts and derivatives,
 however, cannot be released under any other type of license.  The
 requirement for fonts to remain under this license does not apply to
 any document created using the fonts or their derivatives.
 .
 .
 .
 DEFINITIONS
 "Font Software" refers to the set of files released by the Copyright
 Holder(s) under this license and clearly marked as such.
 This may include source files, build scripts and documentation.
 .
 "Reserved Font Name" refers to any names specified as such after the
 copyright statement(s).
 .
 "Original Version" refers to the collection of Font Software components
 as distributed by the Copyright Holder(s).
 .
 "Modified Version" refers to any derivative made by adding to, deleting,
 or substituting ? in part or in whole ?
 any of the components of the Original Version, by changing formats or
 by porting the Font Software to a new environment.
 .
 "Author" refers to any designer, engineer, programmer, technical writer
 or other person who contributed to the Font Software.
 .
 .
 PERMISSION & CONDITIONS
 .
 Permission is hereby granted, free of charge, to any person obtaining a
 copy of the Font Software, to use, study, copy, merge, embed, modify,
 redistribute, and sell modified and unmodified copies of the Font
 Software, subject to the following conditions:
 .
 1) Neither the Font Software nor any of its individual components,in
    Original or Modified Versions, may be sold by itself.
 .
 2) Original or Modified Versions of the Font Software may be bundled,
    redistributed and/or sold with any software, provided that each copy
    contains the above copyright notice and this license. These can be
    included either as stand-alone text files, human-readable headers or
    in the appropriate machine-readable metadata fields within text or
    binary files as long as those fields can be easily viewed by the user.
 .
 3) No Modified Version of the Font Software may use the Reserved Font
    Name(s) unless explicit written permission is granted by the
    corresponding Copyright Holder. This restriction only applies to the
    primary font name as presented to the users.
 .
 4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
    Software shall not be used to promote, endorse or advertise any
    Modified Version, except to acknowledge the contribution(s) of the
    Copyright Holder(s) and the Author(s) or with their explicit written
    permission.
 .
 5) The Font Software, modified or unmodified, in part or in whole, must
    be distributed entirely under this license, and must not be distributed
    under any other license. The requirement for fonts to remain under
    this license does not apply to any document created using the Font
    Software.
 .
 .
 .
 TERMINATION
 This license becomes null and void if any of the above conditions are not met.
 .
 .
 .
 DISCLAIMER
 THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
 MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
 OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT.  IN NO EVENT SHALL THE
 COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
 DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM OTHER
 DEALINGS IN THE FONT SOFTWARE.
 .
*/

const crypto = require('crypto');
const { createCanvas, Path2D } = require('@napi-rs/canvas');

// Karakter yang mudah tertukar sengaja tidak digunakan: 0/O dan 1/I/L.
const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const WIDTH = 420;
const HEIGHT = 140;
const GLYPHS = {"A":["M1133 0 1008 360H471L346 0H51L565 1409H913L1425 0ZM739 1192 733 1170Q723 1134 709.0 1088.0Q695 1042 537 582H942L803 987L760 1123Z",51,0,1425,1409,1479],"B":["M1386 402Q1386 210 1242.0 105.0Q1098 0 842 0H137V1409H782Q1040 1409 1172.5 1319.5Q1305 1230 1305 1055Q1305 935 1238.5 852.5Q1172 770 1036 741Q1207 721 1296.5 633.5Q1386 546 1386 402ZM1008 1015Q1008 1110 947.5 1150.0Q887 1190 768 1190H432V841H770Q895 841 951.5 884.5Q1008 928 1008 1015ZM1090 425Q1090 623 806 623H432V219H817Q959 219 1024.5 270.5Q1090 322 1090 425Z",137,0,1386,1409,1479],"C":["M795 212Q1062 212 1166 480L1423 383Q1340 179 1179.5 79.5Q1019 -20 795 -20Q455 -20 269.5 172.5Q84 365 84 711Q84 1058 263.0 1244.0Q442 1430 782 1430Q1030 1430 1186.0 1330.5Q1342 1231 1405 1038L1145 967Q1112 1073 1015.5 1135.5Q919 1198 788 1198Q588 1198 484.5 1074.0Q381 950 381 711Q381 468 487.5 340.0Q594 212 795 212Z",84,-20,1423,1430,1479],"D":["M1393 715Q1393 497 1307.5 334.5Q1222 172 1065.5 86.0Q909 0 707 0H137V1409H647Q1003 1409 1198.0 1229.5Q1393 1050 1393 715ZM1096 715Q1096 942 978.0 1061.5Q860 1181 641 1181H432V228H682Q872 228 984.0 359.0Q1096 490 1096 715Z",137,0,1393,1409,1479],"E":["M137 0V1409H1245V1181H432V827H1184V599H432V228H1286V0Z",137,0,1286,1409,1366],"F":["M432 1181V745H1153V517H432V0H137V1409H1176V1181Z",137,0,1176,1409,1251],"G":["M806 211Q921 211 1029.0 244.5Q1137 278 1196 330V525H852V743H1466V225Q1354 110 1174.5 45.0Q995 -20 798 -20Q454 -20 269.0 170.5Q84 361 84 711Q84 1059 270.0 1244.5Q456 1430 805 1430Q1301 1430 1436 1063L1164 981Q1120 1088 1026.0 1143.0Q932 1198 805 1198Q597 1198 489.0 1072.0Q381 946 381 711Q381 472 492.5 341.5Q604 211 806 211Z",84,-20,1466,1430,1593],"H":["M1046 0V604H432V0H137V1409H432V848H1046V1409H1341V0Z",137,0,1341,1409,1479],"J":["M524 -20Q305 -20 187.5 75.0Q70 170 31 382L324 425Q342 316 391.0 263.5Q440 211 526 211Q614 211 659.5 270.0Q705 329 705 439V1178H424V1409H999V446Q999 226 874.0 103.0Q749 -20 524 -20Z",31,-20,999,1409,1139],"K":["M1112 0 606 647 432 514V0H137V1409H432V770L1067 1409H1411L809 813L1460 0Z",137,0,1460,1409,1479],"M":["M1307 0V854Q1307 883 1307.5 912.0Q1308 941 1317 1161Q1246 892 1212 786L958 0H748L494 786L387 1161Q399 929 399 854V0H137V1409H532L784 621L806 545L854 356L917 582L1176 1409H1569V0Z",137,0,1569,1409,1706],"N":["M995 0 381 1085Q399 927 399 831V0H137V1409H474L1097 315Q1079 466 1079 590V1409H1341V0Z",137,0,1341,1409,1479],"P":["M1296 963Q1296 827 1234.0 720.0Q1172 613 1056.5 554.5Q941 496 782 496H432V0H137V1409H770Q1023 1409 1159.5 1292.5Q1296 1176 1296 963ZM999 958Q999 1180 737 1180H432V723H745Q867 723 933.0 783.5Q999 844 999 958Z",137,0,1296,1409,1366],"Q":["M1507 711Q1507 429 1368.5 241.5Q1230 54 983 4Q1017 -95 1078.5 -139.0Q1140 -183 1251 -183Q1310 -183 1370 -173L1368 -375Q1242 -403 1126 -403Q963 -403 856.0 -312.0Q749 -221 684 -10Q399 17 241.5 207.5Q84 398 84 711Q84 1050 272.0 1240.0Q460 1430 795 1430Q1130 1430 1318.5 1238.0Q1507 1046 1507 711ZM1206 711Q1206 939 1098.0 1068.5Q990 1198 795 1198Q597 1198 489.0 1069.5Q381 941 381 711Q381 479 491.0 345.0Q601 211 793 211Q991 211 1098.5 341.0Q1206 471 1206 711Z",84,-403,1507,1430,1593],"R":["M1105 0 778 535H432V0H137V1409H841Q1093 1409 1230.0 1300.5Q1367 1192 1367 989Q1367 841 1283.0 733.5Q1199 626 1056 592L1437 0ZM1070 977Q1070 1180 810 1180H432V764H818Q942 764 1006.0 820.0Q1070 876 1070 977Z",137,0,1437,1409,1479],"S":["M1286 406Q1286 199 1132.5 89.5Q979 -20 682 -20Q411 -20 257.0 76.0Q103 172 59 367L344 414Q373 302 457.0 251.5Q541 201 690 201Q999 201 999 389Q999 449 963.5 488.0Q928 527 863.5 553.0Q799 579 616 616Q458 653 396.0 675.5Q334 698 284.0 728.5Q234 759 199.0 802.0Q164 845 144.5 903.0Q125 961 125 1036Q125 1227 268.5 1328.5Q412 1430 686 1430Q948 1430 1079.5 1348.0Q1211 1266 1249 1077L963 1038Q941 1129 873.5 1175.0Q806 1221 680 1221Q412 1221 412 1053Q412 998 440.5 963.0Q469 928 525.0 903.5Q581 879 752 842Q955 799 1042.5 762.5Q1130 726 1181.0 677.5Q1232 629 1259.0 561.5Q1286 494 1286 406Z",59,-20,1286,1430,1366],"T":["M773 1181V0H478V1181H23V1409H1229V1181Z",23,0,1229,1409,1251],"U":["M723 -20Q432 -20 277.5 122.0Q123 264 123 528V1409H418V551Q418 384 497.5 297.5Q577 211 731 211Q889 211 974.0 301.5Q1059 392 1059 561V1409H1354V543Q1354 275 1188.5 127.5Q1023 -20 723 -20Z",123,-20,1354,1409,1479],"V":["M834 0H535L14 1409H322L612 504Q639 416 686 238L707 324L758 504L1047 1409H1352Z",14,0,1352,1409,1366],"W":["M1567 0H1217L1026 815Q991 959 967 1116Q943 985 928.0 916.5Q913 848 715 0H365L2 1409H301L505 499L551 279Q579 418 605.5 544.5Q632 671 805 1409H1135L1313 659Q1334 575 1384 279L1409 395L1462 625L1632 1409H1931Z",2,0,1931,1409,1933],"X":["M1038 0 684 561 330 0H18L506 741L59 1409H371L684 911L997 1409H1307L879 741L1348 0Z",18,0,1348,1409,1366],"Y":["M831 578V0H537V578L35 1409H344L682 813L1024 1409H1333Z",35,0,1333,1409,1366],"Z":["M1192 0H61V209L823 1178H137V1409H1151V1204L389 231H1192Z",61,0,1192,1409,1251],"2":["M71 0V195Q126 316 227.5 431.0Q329 546 483 671Q631 791 690.5 869.0Q750 947 750 1022Q750 1206 565 1206Q475 1206 427.5 1157.5Q380 1109 366 1012L83 1028Q107 1224 229.5 1327.0Q352 1430 563 1430Q791 1430 913.0 1326.0Q1035 1222 1035 1034Q1035 935 996.0 855.0Q957 775 896.0 707.5Q835 640 760.5 581.0Q686 522 616.0 466.0Q546 410 488.5 353.0Q431 296 403 231H1057V0Z",71,0,1057,1430,1139],"3":["M1065 391Q1065 193 935.0 85.0Q805 -23 565 -23Q338 -23 204.0 81.5Q70 186 47 383L333 408Q360 205 564 205Q665 205 721.0 255.0Q777 305 777 408Q777 502 709.0 552.0Q641 602 507 602H409V829H501Q622 829 683.0 878.5Q744 928 744 1020Q744 1107 695.5 1156.5Q647 1206 554 1206Q467 1206 413.5 1158.0Q360 1110 352 1022L71 1042Q93 1224 222.0 1327.0Q351 1430 559 1430Q780 1430 904.5 1330.5Q1029 1231 1029 1055Q1029 923 951.5 838.0Q874 753 728 725V721Q890 702 977.5 614.5Q1065 527 1065 391Z",47,-23,1065,1430,1139],"4":["M940 287V0H672V287H31V498L626 1409H940V496H1128V287ZM672 957Q672 1011 675.5 1074.0Q679 1137 681 1155Q655 1099 587 993L260 496H672Z",31,0,1128,1409,1139],"5":["M1082 469Q1082 245 942.5 112.5Q803 -20 560 -20Q348 -20 220.5 75.5Q93 171 63 352L344 375Q366 285 422.0 244.0Q478 203 563 203Q668 203 730.5 270.0Q793 337 793 463Q793 574 734.0 640.5Q675 707 569 707Q452 707 378 616H104L153 1409H1000V1200H408L385 844Q487 934 640 934Q841 934 961.5 809.0Q1082 684 1082 469Z",63,-20,1082,1409,1139],"6":["M1065 461Q1065 236 939.0 108.0Q813 -20 591 -20Q342 -20 208.5 154.5Q75 329 75 672Q75 1049 210.5 1239.5Q346 1430 598 1430Q777 1430 880.5 1351.0Q984 1272 1027 1106L762 1069Q724 1208 592 1208Q479 1208 414.5 1095.0Q350 982 350 752Q395 827 475.0 867.0Q555 907 656 907Q845 907 955.0 787.0Q1065 667 1065 461ZM783 453Q783 573 727.5 636.5Q672 700 575 700Q482 700 426.0 640.5Q370 581 370 483Q370 360 428.5 279.5Q487 199 582 199Q677 199 730.0 266.5Q783 334 783 453Z",75,-20,1065,1430,1139],"7":["M1049 1186Q954 1036 869.5 895.0Q785 754 722.0 611.5Q659 469 622.5 318.5Q586 168 586 0H293Q293 176 339.0 340.5Q385 505 472.0 675.5Q559 846 788 1178H88V1409H1049Z",88,0,1049,1409,1139],"8":["M1076 397Q1076 199 945.0 89.5Q814 -20 571 -20Q330 -20 197.5 89.0Q65 198 65 395Q65 530 143.0 622.5Q221 715 352 737V741Q238 766 168.0 854.0Q98 942 98 1057Q98 1230 220.5 1330.0Q343 1430 567 1430Q796 1430 918.5 1332.5Q1041 1235 1041 1055Q1041 940 971.5 853.0Q902 766 785 743V739Q921 717 998.5 627.5Q1076 538 1076 397ZM752 1040Q752 1140 706.0 1186.5Q660 1233 567 1233Q385 1233 385 1040Q385 838 569 838Q661 838 706.5 885.0Q752 932 752 1040ZM785 420Q785 641 565 641Q463 641 408.5 583.0Q354 525 354 416Q354 292 408.0 235.0Q462 178 573 178Q682 178 733.5 235.0Q785 292 785 420Z",65,-20,1076,1430,1139],"9":["M1063 727Q1063 352 926.0 166.0Q789 -20 537 -20Q351 -20 245.5 59.5Q140 139 96 311L360 348Q399 201 540 201Q658 201 721.5 314.0Q785 427 787 649Q749 574 662.5 531.5Q576 489 476 489Q290 489 180.5 615.5Q71 742 71 958Q71 1180 199.5 1305.0Q328 1430 563 1430Q816 1430 939.5 1254.5Q1063 1079 1063 727ZM766 924Q766 1055 708.5 1132.5Q651 1210 556 1210Q463 1210 409.5 1142.5Q356 1075 356 956Q356 839 409.0 768.5Q462 698 557 698Q647 698 706.5 759.5Q766 821 766 924Z",71,-20,1063,1430,1139]};

function randFloat(min, max) {
  return min + (crypto.randomInt(0, 1_000_000) / 1_000_000) * (max - min);
}

function generateCode(length = 5) {
  if (!Number.isInteger(length) || length < 4 || length > 7) {
    throw new RangeError('Panjang CAPTCHA harus antara 4 sampai 7 karakter.');
  }

  let output = '';
  for (let i = 0; i < length; i++) {
    output += CHARS[crypto.randomInt(0, CHARS.length)];
  }
  return output;
}

/**
 * Render CAPTCHA menggunakan outline vektor Path2D.
 * Tidak memakai fillText/font OS, sehingga tetap tampil pada VPS minimal
 * yang tidak memiliki paket font terpasang.
 */
function renderCaptcha(code) {
  if (
    typeof code !== 'string' ||
    code.length < 4 ||
    code.length > 7 ||
    [...code].some((character) => !Object.prototype.hasOwnProperty.call(GLYPHS, character))
  ) {
    throw new TypeError('Kode CAPTCHA harus berisi 4 sampai 7 karakter yang didukung.');
  }

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // Latar terang dengan batas tipis.
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, WIDTH - 2, HEIGHT - 2);

  // Noise lembut hanya di latar, tidak melintasi karakter.
  ctx.save();
  ctx.strokeStyle = 'rgba(100, 116, 139, 0.15)';
  ctx.lineWidth = 1.5;

  ctx.beginPath();
  ctx.moveTo(12, 17);
  ctx.bezierCurveTo(105, 2, 155, 30, 230, 16);
  ctx.bezierCurveTo(305, 3, 350, 23, WIDTH - 12, 12);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(12, HEIGHT - 17);
  ctx.bezierCurveTo(105, HEIGHT - 2, 155, HEIGHT - 30, 230, HEIGHT - 16);
  ctx.bezierCurveTo(305, HEIGHT - 3, 350, HEIGHT - 23, WIDTH - 12, HEIGHT - 12);
  ctx.stroke();

  for (let i = 0; i < 28; i++) {
    ctx.fillStyle = `rgba(71, 85, 105, ${randFloat(0.035, 0.09)})`;
    ctx.beginPath();
    ctx.arc(
      randFloat(8, WIDTH - 8),
      randFloat(8, HEIGHT - 8),
      randFloat(0.5, 1.0),
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
  ctx.restore();

  // Semua karakter digambar sebagai path vektor, bukan teks/font sistem.
  const cellWidth = WIDTH / code.length;
  const targetGlyphHeight = code.length >= 7 ? 68 : 78;

  for (let index = 0; index < code.length; index++) {
    const character = code[index];
    const [pathData, xMin, yMin, xMax, yMax, advance] = GLYPHS[character];
    const glyphPath = new Path2D(pathData);

    const glyphWidth = xMax - xMin;
    const glyphHeight = yMax - yMin;
    const scale = Math.min(
      targetGlyphHeight / glyphHeight,
      (cellWidth - 16) / Math.max(advance, glyphWidth)
    );

    const centerX = cellWidth * (index + 0.5);
    const centerY = HEIGHT / 2 + randFloat(-2, 2);
    const glyphCenterX = (xMin + xMax) / 2;
    const glyphCenterY = (yMin + yMax) / 2;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(randFloat(-0.025, 0.025));
    ctx.scale(scale, -scale);
    ctx.translate(-glyphCenterX, -glyphCenterY);

    // Outline putih memisahkan karakter dari latar.
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 76;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke(glyphPath);

    // Isi gelap pekat. Path2D tidak membutuhkan font yang terpasang di VPS.
    ctx.fillStyle = '#111827';
    ctx.fill(glyphPath);

    ctx.restore();
  }

  return canvas.toBuffer('image/png');
}

module.exports = { generateCode, renderCaptcha };
