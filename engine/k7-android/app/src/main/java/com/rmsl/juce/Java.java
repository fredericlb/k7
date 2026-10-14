// JUCE's bootstrap class, kept at JUCE's name because the engine's JNI_OnLoad registers initialiseJUCE
// on exactly com/rmsl/juce/Java. JUCE's own copy (juce_core/native/javacore/init) loads "juce_jni";
// this one loads the engine library, which is where JUCE lives in this app. See docs/android.md.

package com.rmsl.juce;

import android.content.Context;

public class Java
{
    static
    {
        System.loadLibrary ("k7runtime");
    }

    public native static void initialiseJUCE (Context appContext);
}
