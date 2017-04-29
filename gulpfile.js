'use strict';

const gulp = require('gulp');

gulp.task('default', ['check']);

gulp.task('check', (done) => {
    // return gulp.src(['**/*.ts', '!**/*.d.ts', '!node_modules/**'])
    done();
});
